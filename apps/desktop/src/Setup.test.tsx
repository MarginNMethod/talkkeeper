import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Setup, SetupFailure } from "./Setup";
import { SetupCard } from "./SetupCard";
import { useSetup } from "./useSetup";
import { invoke, data } from "./api";
const mocks = vi.hoisted(() => ({ listeners: {} as Record<string,(e:{payload:unknown})=>void> }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name: string, callback: (e:{payload:unknown})=>void) => { mocks.listeners[name] = callback; return () => {}; }) }));
vi.mock("./api", () => ({ invoke: vi.fn(), data:vi.fn() }));
const plan = { llm: { friendly_name: "Compact conversation AI", approx_download_gb: 2.7, license: "Apache-2.0", notes: "Open model weights." }, whisper: { approx_download_mb: 78 }, total_download_bytes: 6.8e9, hardware: { free_disk_bytes: 20e9 }, notice: null, can_install: true };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
function Harness() { const setup = useSetup(); const [view,setView] = React.useState(false); return <><button onClick={()=>setView(!view)}>Settings</button>{!setup.started && <Setup setup={setup} onStart={()=>{}} />}<SetupCard setup={setup} />{view && <p>Settings open</p>}</>; }
import React from "react";
function mockCommands() { vi.mocked(invoke).mockImplementation(async command => { if(command === "setup_plan")return plan; if(command === "setup_status")return {completed:false,custom:false}; if(command === "setup_run")return new Promise(()=>{}); }); }
test("one click leaves welcome and card survives Settings with sizes and pause", async()=>{
  mockCommands(); render(<Harness />); await screen.findByText(/Downloads 6.8/);
  fireEvent.click(screen.getByText("Get started"));
  act(()=>mocks.listeners["setup://progress"]({payload:{stage:"PullModel",completed:1.35e9,total:2.7e9,message:"Downloading"}}));
  expect(screen.getByText(/1.4 of 6.8 GB/)).toBeTruthy();
  fireEvent.click(screen.getByText("Settings")); expect(screen.getByText(/1.4 of 6.8 GB/)).toBeTruthy();
  fireEvent.click(screen.getByText("Pause")); await screen.findByText(/Download paused/); expect(screen.getByText("Resume")).toBeTruthy();
});
test("waiting, checking and speech readiness update independently",async()=>{
  mockCommands();render(<Harness />);await screen.findByText(/Downloads 6.8/);fireEvent.click(screen.getByText("Get started"));
  act(()=>mocks.listeners["setup://progress"]({payload:{stage:"Check",completed:0,total:0,message:"Waiting for the internet"}}));
  expect(screen.getByText(/Waiting for the internet. Your download/)).toBeTruthy();
  act(()=>mocks.listeners["setup://unlocked"]({payload:"speech"}));expect(screen.getByText("Recording · ready")).toBeTruthy();expect(screen.getByText("AI notes · waiting")).toBeTruthy();
  act(()=>mocks.listeners["setup://progress"]({payload:{stage:"Verify",completed:0,total:1,message:"Checking"}}));
  expect(screen.getByLabelText("Setup progress").getAttribute("value")).toBe("99");expect(screen.getByText("Checking your AI…")).toBeTruthy();
});
test.each(["success","denied"])("microphone check %s uses backend and exact outcome",async(outcome)=>{
  mockCommands(); const implementation=vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async(command,args,options)=>command === "setup_check_microphone" ? outcome : implementation(command,args,options));
  render(<Harness />);await screen.findByText(/Downloads 6.8/);fireEvent.click(screen.getByText("Get started"));act(()=>mocks.listeners["setup://unlocked"]({payload:"speech"}));fireEvent.click(screen.getByText("Check my microphone"));
  await screen.findByText(outcome === "success" ? "Your microphone works. You're ready to record." : "TalkKeeper isn't allowed to use the microphone. Turn it on in your computer's privacy settings, then come back.");
  if(outcome === "denied") {fireEvent.click(screen.getByText("Open privacy settings"));await waitFor(()=>expect(invoke).toHaveBeenCalledWith("open_microphone_settings"));}
});

test("time remaining uses recent throughput after the first ten seconds",async()=>{
  mockCommands();const now=vi.spyOn(Date,"now");now.mockReturnValue(0);
  render(<Harness />);await screen.findByText(/Downloads 6.8/);fireEvent.click(screen.getByText("Get started"));
  act(()=>mocks.listeners["setup://progress"]({payload:{stage:"PullModel",completed:100e6,total:2.7e9,message:"Downloading"}}));
  now.mockReturnValue(12000);
  act(()=>mocks.listeners["setup://progress"]({payload:{stage:"PullModel",completed:200e6,total:2.7e9,message:"Downloading"}}));
  expect(screen.getByText(/0.2 of 6.8 GB · about 14 min left/)).toBeTruthy();now.mockRestore();
});

test("own provider tests without saving, then saves the selected model and key",async()=>{
  mockCommands();const implementation=vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async(command,args,options)=>command === "setup_test_provider" ? [{id:"chosen-by-user"}] : implementation(command,args,options));
  render(<Harness />);fireEvent.click(await screen.findByText("I already have my own AI provider"));
  fireEvent.change(screen.getByLabelText("Provider"),{target:{value:"OpenAICompatible"}});
  fireEvent.change(screen.getByLabelText("API key"),{target:{value:"test-key"}});
  fireEvent.click(screen.getByText("Test connection"));await screen.findByText("Connected. 1 models found.");
  expect(data).not.toHaveBeenCalledWith("save_settings",expect.anything());
  fireEvent.change(screen.getByLabelText("AI model"),{target:{value:"chosen-by-user"}});
  fireEvent.click(screen.getByText("Save and continue"));
  await waitFor(()=>expect(data).toHaveBeenCalledWith("set_key",{name:"llm",key:"test-key"}));
  await waitFor(()=>expect(data).toHaveBeenCalledWith("save_settings",expect.objectContaining({model:"chosen-by-user"})));
});

test("saved settings failure offers Try again and Start anyway",async()=>{
  mockCommands();const implementation=vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async(command,args,options)=>{if(command === "setup_status")throw new Error("Unavailable");return implementation(command,args,options);});
  vi.mocked(data).mockResolvedValue([]);
  const {App}=await import("./App");render(<App />);
  await screen.findByText("TalkKeeper couldn't open its saved settings.");
  expect(screen.getByRole("button",{name:"Try again"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Start anyway"}));
  await waitFor(()=>expect(screen.queryByText("TalkKeeper couldn't open its saved settings.")).toBeNull());
  expect(screen.getByRole("button",{name:"New note"}).hasAttribute("disabled")).toBe(false);
});

test.each([
  ["Cannot download. Check your connection and allow TalkKeeper through your firewall, then retry.","Waiting for the internet"],
  ["Downloads are blocked. Allow TalkKeeper through your firewall or network filter, then retry.","Something is blocking the download"],
  ["This computer has too little memory for local AI. Connect your own AI provider.","This computer can't run the built-in AI"],
  ["Not enough storage. Free space on the application drive, then retry.","Not enough free space"],
  ["The AI engine could not start. Close other AI apps, restart TalkKeeper, then retry.","The AI engine didn't start"],
  ["The download did not pass its integrity check. Retry to download a fresh copy.","The download was damaged"],
  ["The engine archive is unsafe or incomplete. Retry the download.","The download was damaged"],
  ["The model catalog is invalid. Restore the bundled catalog or update TalkKeeper.","This copy of TalkKeeper is damaged"],
  ["Automatic setup is unavailable on this platform. Connect your own AI provider.","The built-in AI isn't available on this computer"],
  ["The AI model did not answer. Free memory and retry, or connect your own AI provider.","The AI model isn't answering"],
  ["The speech model could not be downloaded. Check your connection and free storage, then retry.","The speech model didn't download"],
  ["Cannot write application files. Check free storage and folder permissions, then retry.","TalkKeeper can't save files"],
])("setup error maps to its own plain headline: %s",(error,headline)=>{
  render(<SetupFailure error={error} retry={()=>{}} own={()=>{}} />);
  expect(screen.getByRole("heading",{name:headline})).toBeTruthy();
});
