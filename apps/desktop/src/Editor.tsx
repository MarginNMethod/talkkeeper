import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { useEffect } from "react";
import type { JSONContent } from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
export function Editor({
  content,
  document,
  editable = true,
  onChange,
}: {
  content: string;
  document?: unknown;
  editable?: boolean;
  onChange: (doc: unknown, markdown: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ allowBase64: true }),
      Markdown,
    ],
    content:
      document && typeof document === "object"
        ? (document as JSONContent)
        : content,
    contentType: document && typeof document === "object" ? "json" : "markdown",
    editable,
    editorProps: {
      attributes: { "aria-label": "Rough notes", role: "textbox" },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        for (const file of files) {
          const reader = new FileReader();
          reader.onload = () => {
            view.dispatch(
              view.state.tr.replaceSelectionWith(
                view.state.schema.nodes.image.create({ src: reader.result }),
              ),
            );
          };
          reader.readAsDataURL(file);
        }
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON(), editor.getMarkdown()),
  });
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);
  return (
    <section>
      <div className="toolbar" aria-label="Editor toolbar">
        {[
          ["Bold", () => editor?.chain().focus().toggleBold().run()],
          ["Italic", () => editor?.chain().focus().toggleItalic().run()],
          [
            "Heading",
            () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
          ],
          ["Bullets", () => editor?.chain().focus().toggleBulletList().run()],
          ["Numbered", () => editor?.chain().focus().toggleOrderedList().run()],
          ["Checklist", () => editor?.chain().focus().toggleTaskList().run()],
        ].map(([label, run]) => (
          <button key={label as string} onClick={run as () => void}>
            {label as string}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </section>
  );
}
