export function WelcomeCard({ title, children }: { title: string; children?: React.ReactNode }) {
  return <section><h1>{title}</h1>{children}</section>;
}
