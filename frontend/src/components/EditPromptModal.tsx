import { useState, useEffect } from 'react';

interface Prompt {
  id: number;
  name: string;
  text: string;
}

interface Props {
  isOpen: boolean;
  prompt: Prompt | null;
  onClose: () => void;
  onSave: (updated: Prompt) => Promise<void> | void;
}

export default function EditPromptModal({ isOpen, prompt, onClose, onSave }: Props) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(prompt?.text || '');
    setSaving(false);
  }, [prompt, isOpen]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!prompt) return;
    setSaving(true);
    try {
      await onSave({ ...prompt, text });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold mb-2">Edit Prompt: {prompt?.name || ''}</h3>
        <div className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 p-3 rounded mb-4">
          Warning: modifying prompts is likely to cause unexpected behavior and is not recommended. Proceed only if you understand the implications.
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full h-48 p-2 border rounded mb-4"
        />

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 rounded">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
