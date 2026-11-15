import { NotesList, type NotesListProps } from "./NotesList";

export function SpacePage({ name, ...list }: NotesListProps & { name: string }) {
  return <section className="index-page space-page">
    <h1>{name}</h1>
    <p className="page-description">Conversations and ideas, collected in one place.</p>
    <NotesList {...list} />
  </section>;
}
