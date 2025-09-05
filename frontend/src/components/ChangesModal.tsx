import React from 'react';
import { X, Copy, Download } from 'lucide-react';

interface ChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  fileName?: string;
}

const ChangesModal: React.FC<ChangesModalProps> = ({ isOpen, onClose, content }) => {
  if (!isOpen) return null;

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(content);
      alert('Text copied to clipboard!');
    } catch (err) {
      console.error('Could not copy text: ', err);
      alert('Failed to copy text to clipboard');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    // Use a simple, clean filename
    link.download = 'redacted_content.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Modal Overlay */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-40 z-50"
        onClick={onClose}
        style={{ display: isOpen ? 'block' : 'none' }}
      />
      
      {/* Modal Content */}
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
        style={{ display: isOpen ? 'flex' : 'none' }}
      >
        <div className="bg-white rounded-lg shadow-xl w-4/5 max-h-[80vh] flex flex-col pointer-events-auto">
          {/* Modal Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-xl font-semibold">Changes</h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-6 h-6 text-gray-500" />
            </button>
          </div>
          
          {/* Modal Body */}
          <div className="flex-1 overflow-auto p-4">
            <pre className="font-mono text-sm whitespace-pre-wrap break-words">
              {content}
            </pre>
          </div>
          
          {/* Modal Footer */}
          <div className="flex justify-center gap-3 p-4 border-t">
            <button
              onClick={handleCopyToClipboard}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
            >
              <Copy className="w-4 h-4" />
              Copy to Clipboard
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Text
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ChangesModal;