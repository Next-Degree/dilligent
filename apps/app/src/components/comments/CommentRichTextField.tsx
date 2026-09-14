'use client';

import '@/styles/editor.css';
import { createMentionExtension, type MentionUser } from '@trycompai/ui/editor';
import { defaultExtensions } from '@trycompai/ui/editor/extensions';
import type { JSONContent } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

type EditorSizeStyle = CSSProperties & {
  '--editor-min-height': string;
  '--editor-height': string;
};

interface CommentRichTextFieldProps {
  value: JSONContent | null;
  onChange: (value: JSONContent | null) => void;
  members: MentionUser[];
  disabled?: boolean;
  placeholder?: string;
  onMentionSelect?: () => void;
}

interface MemberSearch {
  setMembers: (next: MentionUser[]) => void;
  search: (query: string) => MentionUser[];
}

/**
 * Mutable holder for the latest member list. Lives outside React state so the
 * mention extension (created once) always searches the freshest members
 * without the component touching a ref while rendering.
 */
function createMemberSearch(initialMembers: MentionUser[]): MemberSearch {
  let currentMembers = initialMembers;

  return {
    setMembers: (next: MentionUser[]) => {
      currentMembers = next;
    },
    search: (query: string): MentionUser[] => {
      if (!currentMembers || currentMembers.length === 0) return [];

      // Show first 20 members immediately when query is empty
      if (!query || query.trim() === '') {
        return currentMembers.slice(0, 20);
      }

      // Filter members based on query
      const lowerQuery = query.toLowerCase();
      return currentMembers
        .filter(
          (member) =>
            member.name?.toLowerCase().includes(lowerQuery) ||
            member.email?.toLowerCase().includes(lowerQuery) ||
            member.id?.toLowerCase().includes(lowerQuery),
        )
        .slice(0, 20);
    },
  };
}

export function CommentRichTextField({
  value,
  onChange,
  members,
  disabled = false,
  placeholder = 'Leave a comment (mention users with @)',
  onMentionSelect,
}: CommentRichTextFieldProps) {
  const editorSizeStyles: EditorSizeStyle = useMemo(
    () => ({
      '--editor-min-height': '120px',
      '--editor-height': 'auto',
    }),
    [],
  );

  // The mention extension is created once and looks members up when the user
  // types "@". Keep the list in a mutable store created once, and refresh it
  // from an effect, so the component never reads or writes a ref during render.
  const [memberSearch] = useState(() => createMemberSearch(members));

  useEffect(() => {
    memberSearch.setMembers(members);
  }, [memberSearch, members]);

  const mentionExtension = useMemo(
    () =>
      createMentionExtension({
        suggestion: {
          char: '@',
          items: ({ query }) => {
            return memberSearch.search(query) || [];
          },
          onSelect: () => {
            onMentionSelect?.();
          },
        },
      }),
    [memberSearch, onMentionSelect],
  );

  // Memoize extensions array to prevent recreation
  const extensions = useMemo(
    () => [...defaultExtensions({ placeholder }), mentionExtension],
    [placeholder, mentionExtension],
  );

  const editor = useEditor(
    {
      extensions,
      content: value || '',
      editable: !disabled,
      immediatelyRender: false,
      onUpdate: ({ editor }) => {
        if (!editor.isDestroyed) {
          const content = editor.getJSON();
          onChange(content);
        }
      },
      editorProps: {
        attributes: {
          class:
            'comment-editor prose-sm max-w-none focus:outline-none px-3 py-2 text-sm [&_p]:m-0 [&_p]:p-0 [&_p]:text-sm [&_p]:leading-normal',
        },
      },
    },
    [disabled, placeholder],
  );

  // Sync external value changes to editor
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const currentContent = editor.getJSON();
    if (value && JSON.stringify(currentContent) !== JSON.stringify(value)) {
      editor.commands.setContent(value, { emitUpdate: false });
    } else if (!value && currentContent.content && currentContent.content.length > 0) {
      editor.commands.setContent('', { emitUpdate: false });
    }
  }, [value, editor]);

  return (
    <div
      className="rounded-md bg-background"
      style={{ ...editorSizeStyles, minHeight: 'var(--editor-min-height)' }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
