/**
 * Markdown-safe rich text editor (Tiptap) for protocol authoring.
 * Exposes value/onChange as markdown; toolbar limited to paragraph, bold, italic, lists, link, quote, code.
 */

import type { ReactNode } from "react";
import { EditorContent, type Editor, useEditor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import { createRichTextEditorExtensions } from "@/utils/rich-text-editor-extensions";

const EDITOR_CLASS =
  "min-h-[11rem] px-4 py-3 text-sm leading-6 text-[var(--color-text)] focus:outline-none prose prose-sm max-w-none " +
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[var(--color-border)] [&_th]:bg-[var(--color-surface-elevated)] [&_th]:px-2 [&_th]:py-1.5 [&_td]:border [&_td]:border-[var(--color-border)] [&_td]:px-2 [&_td]:py-1.5";

function ToolbarIcon({ children, className = "h-4 w-4" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

function BulletListIcon() {
  return (
    <ToolbarIcon>
      <circle cx="3" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M6 4h7" />
      <path d="M6 8h7" />
      <path d="M6 12h7" />
    </ToolbarIcon>
  );
}

function LinkIcon() {
  return (
    <ToolbarIcon>
      <path d="M6 10L4.5 11.5a2.5 2.5 0 1 1-3.5-3.5L2.5 6.5" />
      <path d="M10 6l1.5-1.5a2.5 2.5 0 1 1 3.5 3.5L13.5 9.5" />
      <path d="M5.5 10.5l5-5" />
    </ToolbarIcon>
  );
}

function QuoteIcon() {
  return (
    <ToolbarIcon>
      <path d="M5.5 5.5A2.5 2.5 0 0 0 3 8v2.5h3V8H4.5" />
      <path d="M11.5 5.5A2.5 2.5 0 0 0 9 8v2.5h3V8h-1.5" />
    </ToolbarIcon>
  );
}

function InlineCodeIcon() {
  return (
    <ToolbarIcon>
      <path d="M6 5.5l2 5-2 5" />
      <path d="M10 5.5l2 5-2 5" />
    </ToolbarIcon>
  );
}

function CodeBlockIcon() {
  return (
    <ToolbarIcon>
      <path d="M6 4L2.5 8L6 12" />
      <path d="M10 4l3.5 4L10 12" />
      <path d="M8.75 3.5L7.25 12.5" />
    </ToolbarIcon>
  );
}

function TableIcon() {
  return (
    <ToolbarIcon>
      <path d="M2 3h12v2H2V3z" />
      <path d="M2 7h12v1H2V7z" />
      <path d="M2 11h12v1H2v-1z" />
      <path d="M2 15h12v1H2v-1z" />
      <path d="M2 4v11" />
      <path d="M6 4v11" />
      <path d="M10 4v11" />
      <path d="M14 4v11" />
    </ToolbarIcon>
  );
}

function ToolbarButton({
  label,
  ariaLabel,
  active,
  onClick,
}: {
  label: ReactNode;
  ariaLabel: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className={`inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-[var(--radius-sm)] border px-3 text-xs font-medium transition-colors ${
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
      }`}
    >
      {label}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const handleLink = () => {
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Enter URL", previousUrl ?? "https://");
    if (url == null) return;
    const normalized = url.trim();
    if (!normalized) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
  };
  return (
    <div className="flex flex-wrap gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2">
      <ToolbarButton
        label={<span className="text-base leading-none">¶</span>}
        ariaLabel="Paragraph"
        active={editor.isActive("paragraph")}
        onClick={() => editor.chain().focus().setParagraph().run()}
      />
      <ToolbarButton
        label={<strong className="text-sm font-semibold">B</strong>}
        ariaLabel="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label={<em className="text-sm">I</em>}
        ariaLabel="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label={<BulletListIcon />}
        ariaLabel="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label={<span className="text-sm font-semibold">1.</span>}
        ariaLabel="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton label={<LinkIcon />} ariaLabel="Link" active={editor.isActive("link")} onClick={handleLink} />
      <ToolbarButton
        label={<QuoteIcon />}
        ariaLabel="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolbarButton
        label={<InlineCodeIcon />}
        ariaLabel="Inline code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <ToolbarButton
        label={<CodeBlockIcon />}
        ariaLabel="Code block"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      <ToolbarButton
        label={<TableIcon />}
        ariaLabel="Insert table"
        active={editor.isActive("table")}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      />
    </div>
  );
}

export interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  label?: string;
  hint?: string;
  id?: string;
  /** When this changes, editor is remounted with value (e.g. after upload). */
  contentKey?: string;
}

export function RichTextEditor({ value, onChange, label, hint, id, contentKey }: RichTextEditorProps) {
  const lastContentKeyRef = useRef(contentKey);
  const lastEmittedMarkdown = useRef<string | null>(null);
  /** `useEditor` keeps the initial `onUpdate` closure; refs avoid stale `value` / `onChange`. */
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: createRichTextEditorExtensions(),
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: { class: EDITOR_CLASS },
    },
    onUpdate: ({ editor: e }) => {
      const md = (e as Editor & { getMarkdown?: () => string }).getMarkdown?.() ?? "";
      lastEmittedMarkdown.current = md;
      if (md !== valueRef.current) onChangeRef.current(md);
    },
  });

  useEffect(() => {
    if (!editor) return;

    if (contentKey !== lastContentKeyRef.current) {
      lastContentKeyRef.current = contentKey;
      lastEmittedMarkdown.current = value;
      editor.commands.setContent(value, { emitUpdate: false, contentType: "markdown" });
      return;
    }

    if (value !== lastEmittedMarkdown.current) {
      lastEmittedMarkdown.current = value;
      editor.commands.setContent(value, { emitUpdate: false, contentType: "markdown" });
    }
  }, [contentKey, value, editor]);

  return (
    <div>
      {label && (
        <label htmlFor={id} className="mb-2 block font-medium text-[var(--color-text-heading)]">
          {label}
        </label>
      )}
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <Toolbar editor={editor} />
        <EditorContent editor={editor} />
      </div>
      {hint && <p className="mt-2 text-sm text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}
