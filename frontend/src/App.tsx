import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, Upload, FileText, Check, Save, Trash2 } from 'lucide-react';
import axios from 'axios';
import { initializeDiff2HtmlCheckboxes, saveAllFiles, addDiff2HtmlUIFeatures } from './utils/diff2htmlCheckbox';
import ChangesModal from './components/ChangesModal';
import EditPromptModal from './components/EditPromptModal';
import './styles/diff2html-custom.css';

const API_BASE_URL = '/api';

interface FileData {
  name: string;
  size: number;
  file: File;
}

interface ProcessedResult {
  fileName: string;
  original: any[];
  redacted: any[];
  diff_file?: string;
  metrics?: {
    accuracy: number;
    precision: number;
    recall: number;
    kappa: number;
  };
}

declare global {
  interface Window {
    Diff2Html: any;
    Diff2HtmlUI: any;
    jQuery: any;
    $: any;
  }
}

interface Prompt {
  id: number;
  name: string;
  text: string;
}

function App() {
  const [currentStep, setCurrentStep] = useState(1);
  const [uploadedFiles, setUploadedFiles] = useState<FileData[]>([]);
  const [groundTruthFiles, setGroundTruthFiles] = useState<FileData[]>([]);
  const [hasGroundTruth, setHasGroundTruth] = useState(false);
  const [selectedPromptId, setSelectedPromptId] = useState(1);
  const [availablePrompts, setAvailablePrompts] = useState<Prompt[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [processedData, setProcessedData] = useState<ProcessedResult[] | null>(null);
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const [currentDiff, setCurrentDiff] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [useCustomApiKey, setUseCustomApiKey] = useState(false);
  const [mismatchError, setMismatchError] = useState<string>('');
  const [isDraggingMain, setIsDraggingMain] = useState(false);
  const [isDraggingGT, setIsDraggingGT] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState('');
  const [modalFileName, setModalFileName] = useState('');
  const [editPromptOpen, setEditPromptOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  // Persist checkbox states per filename while the session is active
  const [checkboxStates, setCheckboxStates] = useState<{ [fileName: string]: string[] }>({});
  // Column selection state
  const [availableColumns, setAvailableColumns] = useState<any[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  // API configuration state
  const [apiConfig, setApiConfig] = useState<any>(null);

  const handleSavePrompt = async (updated: Prompt) => {
    // Create a new session-only Custom Prompt and select it
    const customPrompt: Prompt = {
      id: Date.now(),
      name: 'Custom Prompt',
      text: updated.text
    };
    // Filter out any existing custom prompts to ensure only one exists
    setAvailablePrompts(prev => [customPrompt, ...prev.filter(p => p.name !== 'Custom Prompt')]);
    setSelectedPromptId(customPrompt.id);
    setEditPromptOpen(false);
    setEditingPrompt(null);
    alert('Custom prompt created for this session only and selected. It will be passed to processing but will not overwrite Prompts.csv.');
  };

  const removeFile = (filename: string, isGroundTruth = false) => {
    if (isGroundTruth) {
      setGroundTruthFiles(prev => prev.filter(f => f.name !== filename));
    } else {
      setUploadedFiles(prev => prev.filter(f => f.name !== filename));
    }
  };

  // Load available prompts and API config on mount
  useEffect(() => {
    loadPrompts();
    loadApiConfig();
  }, []);

  const loadPrompts = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/prompts`);
      // Use backend-provided prompts. If none returned, fall back to a sensible default.
      const promptsArray = (response.data && response.data.length > 0)
        ? response.data
        : [{ id: 1, name: 'Default Prompt', text: 'Please remove any personally identifiable information (PII) and replace with [REDACTED].' }];
      setAvailablePrompts(promptsArray);
      // Ensure a prompt is selected (first one by default)
      if (promptsArray.length > 0) setSelectedPromptId(promptsArray[0].id);
    } catch (error) {
      console.error('Failed to load prompts:', error);
    }
  };

  const loadApiConfig = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/config`);
      setApiConfig(response.data);
    } catch (error) {
      console.error('Failed to load API config:', error);
    }
  };

  const handleStepNavigation = (targetStep: number) => {
    // Only allow navigating to previous steps
    if (targetStep >= currentStep) return;

    // Clear appropriate state when navigating backwards
    if (targetStep === 1) {
      // Going back to file upload - clear everything except uploaded files
      setSessionId(null);
      setProcessedData(null);
      setCurrentDiff('');
      setSelectedFile(null);
      setAvailableColumns([]);
      setSelectedColumns([]);
    } else if (targetStep === 2 && currentStep === 3) {
      // Going back to settings from results - clear results but keep session
      setProcessedData(null);
      setCurrentDiff('');
      setSelectedFile(null);
    }

    setCurrentStep(targetStep);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>, isGroundTruth = false) => {
    const files = event.target.files;
    if (!files) return;

    const fileArray = Array.from(files).map(file => ({
      name: file.name,
      size: file.size,
      file: file
    }));

    // Append new files to existing list; replace entry if same filename
    if (isGroundTruth) {
      setGroundTruthFiles(prev => {
        const map = new Map(prev.map(f => [f.name, f]));
        fileArray.forEach(f => map.set(f.name, f));
        return Array.from(map.values());
      });
    } else {
      setUploadedFiles(prev => {
        const map = new Map(prev.map(f => [f.name, f]));
        fileArray.forEach(f => map.set(f.name, f));
        return Array.from(map.values());
      });
    }
  };

  // Handle file drops onto the UI
  const handleDrop = (event: React.DragEvent, isGroundTruth = false) => {
    event.preventDefault();
    event.stopPropagation();

    const dt = event.dataTransfer;
    if (!dt || !dt.files || dt.files.length === 0) {
      if (isGroundTruth) setIsDraggingGT(false); else setIsDraggingMain(false);
      return;
    }

    const fileArray = Array.from(dt.files).map(file => ({
      name: file.name,
      size: file.size,
      file: file
    }));

    // Append dropped files to the existing list; replace entries with same filename
    if (isGroundTruth) {
      setGroundTruthFiles(prev => {
        const map = new Map(prev.map(f => [f.name, f]));
        fileArray.forEach(f => map.set(f.name, f));
        return Array.from(map.values());
      });
      setIsDraggingGT(false);
    } else {
      setUploadedFiles(prev => {
        const map = new Map(prev.map(f => [f.name, f]));
        fileArray.forEach(f => map.set(f.name, f));
        return Array.from(map.values());
      });
      setIsDraggingMain(false);
    }
  };

  const handleDragOver = (event: React.DragEvent, isGroundTruth = false) => {
    event.preventDefault();
    event.stopPropagation();
    if (isGroundTruth) setIsDraggingGT(true); else setIsDraggingMain(true);
  };

  const handleDragLeave = (event: React.DragEvent, isGroundTruth = false) => {
    event.preventDefault();
    event.stopPropagation();
    if (isGroundTruth) setIsDraggingGT(false); else setIsDraggingMain(false);
  };

  // Helper: normalize base filename for comparison (remove extension and common gt suffixes)
  const normalizeBaseName = (filename: string) => {
    const lower = filename.toLowerCase();
    // Remove extension
    const noExt = lower.replace(/\.[^.]+$/, '');
    // Remove common ground-truth suffixes like _gt or -gt or _groundtruth
    return noExt.replace(/(_|-)?(gt|groundtruth)$/i, '').trim();
  };

  // Validate that uploaded files and ground truth files match by base filename
  const validateFilenameMatching = (uploads: FileData[], gts: FileData[]) => {
    if (!gts || gts.length === 0) {
      setMismatchError('');
      return true;
    }

    if (!uploads || uploads.length === 0) {
      setMismatchError('Please upload the main files before adding ground truth files.');
      return false;
    }

    const uploadBases = uploads.map(f => normalizeBaseName(f.name));
    const gtBases = gts.map(f => normalizeBaseName(f.name));

    // Quick length check
    if (uploadBases.length !== gtBases.length) {
      setMismatchError(`Number of ground truth files (${gtBases.length}) does not match uploaded files (${uploadBases.length}).`);
      return false;
    }

    // Ensure every uploaded base has a matching ground truth base
    const missing = uploadBases.filter(b => !gtBases.includes(b));
    if (missing.length > 0) {
      setMismatchError(`Filename mismatch: could not find ground truth matches for: ${missing.join(', ')}`);
      return false;
    }

    setMismatchError('');
    return true;
  };

  // Re-validate whenever file lists or the toggle change
  useEffect(() => {
    // Only validate if ground truth is enabled
    if (hasGroundTruth) {
      validateFilenameMatching(uploadedFiles, groundTruthFiles);
    } else {
      // Clear any mismatch errors when ground truth is disabled
      setMismatchError('');
    }
  }, [uploadedFiles, groundTruthFiles, hasGroundTruth]);

  const uploadFilesToServer = async () => {
    const formData = new FormData();
    
    uploadedFiles.forEach(fileData => {
      formData.append('files', fileData.file);
    });

    if (hasGroundTruth) {
      groundTruthFiles.forEach(fileData => {
        formData.append('groundTruthFiles', fileData.file);
      });
    }

    try {
      setProcessingStatus('Uploading files...');
      const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout: 120000 // 2 minute timeout for upload
      });
      const newSessionId = response.data.session_id;
      setSessionId(newSessionId);

      // Fetch column information for uploaded files
      await fetchColumnInfo(newSessionId);

      return newSessionId;
    } catch (error) {
      console.error('Upload failed:', error);
      throw error;
    }
  };

  const fetchColumnInfo = async (sessionId: string) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/columns/${sessionId}`);
      const filesData = response.data.files;

      if (filesData && filesData.length > 0) {
        // Merge columns from all files, tracking which files have each column
        const columnMap = new Map<string, any>();

        filesData.forEach((fileData: any) => {
          fileData.columns.forEach((col: any) => {
            if (!columnMap.has(col.name)) {
              columnMap.set(col.name, {
                ...col,
                filesWithColumn: [fileData.fileName]
              });
            } else {
              const existing = columnMap.get(col.name);
              existing.filesWithColumn.push(fileData.fileName);
              // Keep as recommended if any file recommends it
              existing.recommended = existing.recommended || col.recommended;
            }
          });
        });

        const mergedColumns = Array.from(columnMap.values());
        setAvailableColumns(mergedColumns);

        // Auto-select recommended text columns
        const recommendedColumns = mergedColumns
          .filter((col: any) => col.recommended)
          .map((col: any) => col.name);

        if (recommendedColumns.length > 0) {
          setSelectedColumns(recommendedColumns);
        } else {
          const textColumns = mergedColumns
            .filter((col: any) => col.is_text)
            .map((col: any) => col.name);
          setSelectedColumns(textColumns);
        }
      }
    } catch (error) {
      console.error('Failed to fetch column info:', error);
    }
  };

  const processFiles = async () => {
    // Only check API key if user wants to use their own
    if (useCustomApiKey && !apiKey) {
      alert('Please enter your OpenAI API key or uncheck "Use Custom API Key"');
      return;
    }

    // Check total file size and warn if large
    const totalSize = uploadedFiles.reduce((sum, f) => sum + f.size, 0);
    const totalSizeMB = totalSize / (1024 * 1024);
    
    // Estimate row count (rough estimate: 1 row ≈ 200 bytes average)
    const estimatedRows = Math.floor(totalSize / 200);
    
    if (totalSizeMB > 5 || estimatedRows > 200) {
      const proceed = confirm(
        `Warning: Your file appears to contain approximately ${estimatedRows} rows (${totalSizeMB.toFixed(2)} MB).\n\n` +
        `Processing time (with batch processing - 8 rows per call):\n` +
        `• 100 rows ≈ 1-2 minutes\n` +
        `• 200 rows ≈ 3-5 minutes\n` +
        `• 500 rows ≈ 8-12 minutes\n` +
        `• 1000+ rows ≈ 15-25 minutes (may timeout)\n\n` +
        `For files over 500 rows, consider:\n` +
        `• Splitting into smaller files (recommended: < 300 rows each)\n` +
        `• Processing in multiple sessions\n\n` +
        `Do you want to continue?`
      );
      if (!proceed) return;
    }

    setProcessing(true);
    setProcessingStatus('Preparing files...');

    try {
      // Upload files if not already uploaded
      let newSessionId = sessionId;
      if (!newSessionId) {
        newSessionId = await uploadFilesToServer();
      }
      
      // Start polling for progress
      progressIntervalRef.current = window.setInterval(async () => {
        try {
          const progressResponse = await axios.get(`${API_BASE_URL}/progress/${newSessionId}`);
          const progress = progressResponse.data;
          
          if (progress.status === 'processing' && progress.total > 0) {
            setProcessingStatus(
              `Processing batch ${progress.current} of ${progress.total}... Please wait.`
            );
          }
        } catch (error) {
          console.error('Error fetching progress:', error);
        }
      }, 2000); // Poll every 2 seconds
      
      // Get the selected prompt
      const selectedPrompt = availablePrompts.find(p => p.id === selectedPromptId) || null;

      // If user selected a session-only Custom Prompt, send prompt_text only and omit prompt_index
      let payload: any = { session_id: newSessionId };

      // Only include API key if user wants to use their own
      if (useCustomApiKey && apiKey) {
        payload.api_key = apiKey;
      }

      // Include selected columns for processing
      if (selectedColumns.length > 0) {
        payload.columns_to_process = selectedColumns;
      }

      if (selectedPrompt) {
        if (selectedPrompt.name === 'Custom Prompt') {
          // Custom session-only prompt: send only prompt_text (backend will use it)
          payload.prompt_text = selectedPrompt.text;
        } else {
          // Stored backend prompt: send index (backend expects zero-based index)
          payload.prompt_index = Math.max(0, selectedPrompt.id - 1);
        }
      }

      setProcessingStatus('Processing with AI in batches...');
      
      const response = await axios.post(`${API_BASE_URL}/deidentify`, payload, {
        timeout: 600000, // 10 minute timeout for processing
        onDownloadProgress: () => {
          // Keep connection alive indicator
          setProcessingStatus((prev) => prev + '.');
        }
      });
      
      // Stop polling
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      
      const results = response.data.results;
      console.log('Processing results:', results);
      
      setProcessedData(results);
      setProcessing(false);
      setProcessingStatus('');
      setCurrentStep(3);
      
      if (results.length > 0) {
        setSelectedFile(results[0].fileName);
      }
    } catch (error: any) {
      console.error('Processing failed:', error);
      
      // Stop polling if still running
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      
      setProcessing(false);
      setProcessingStatus('');
      
      // Provide more helpful error messages
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        alert(
          'Processing timeout: Your file is too large to process in one request.\n\n' +
          'Even with batch processing (8 rows per call), this file exceeds the time limit.\n\n' +
          'Suggestions:\n' +
          '• Split your CSV into smaller files (recommend < 200 rows each)\n' +
          '• Reduce the number of rows per file\n' +
          '• Process files individually rather than in batch'
        );
      } else if (error.response?.status === 504) {
        alert(
          'Gateway timeout: The server took too long to respond.\n\n' +
          'This usually means your file has too many rows. Try:\n' +
          '• Splitting into files with < 200 rows each\n' +
          '• Processing fewer rows at a time\n' +
          '• Selecting fewer columns to process\n\n' +
          'Note: Batch processing is enabled, but very large files may still timeout.'
        );
      } else if (error.response?.status === 401) {
        alert('Invalid API key. Please check your OpenAI API key and try again.');
      } else {
        alert('Processing failed. Please check your API key and try again.\n\nError: ' + (error.message || 'Unknown error'));
      }
    }
  };

  // Check if libraries are loaded on mount
  useEffect(() => {
    const checkLibraries = () => {
      console.log('Library check:');
      console.log('- window.Diff2Html:', typeof window.Diff2Html);
      console.log('- window.Diff2HtmlUI:', typeof window.Diff2HtmlUI);
      console.log('- window.jQuery:', typeof window.jQuery);
      
      if (!window.Diff2Html) {
        console.error('Diff2Html not loaded! Check if script is included correctly.');
      }
      if (!window.jQuery) {
        console.error('jQuery not loaded! Check if script is included correctly.');
      }
    };
    
    // Check immediately and after a delay
    checkLibraries();
    setTimeout(checkLibraries, 1000);
  }, []);

  // Initialize diff2html when diff content changes
  useEffect(() => {
    if (currentDiff && diffContainerRef.current) {
      // Add a delay to ensure DOM is ready, with retry mechanism
      const tryRender = (attempts = 0) => {
        if (attempts > 3) return; // Stop after 3 attempts
        
        setTimeout(() => {
          if (diffContainerRef.current) {
            renderDiff2Html();
          } else {
            // Retry if container still not ready
            tryRender(attempts + 1);
          }
        }, 200 * (attempts + 1)); // Increase delay with each attempt
      };
      
      tryRender();
    }
  }, [currentDiff]);

  // Render diff using diff2html (simplified version from example)
  const renderDiff2Html = () => {
    if (!diffContainerRef.current || !currentDiff) {
      console.log('Missing refs or diff:', { hasRef: !!diffContainerRef.current, hasDiff: !!currentDiff });
      return;
    }
    
    const targetElement = diffContainerRef.current;
    
    // Clear previous content
    targetElement.innerHTML = '';
    
    // Check if Diff2Html is available
    if (!window.Diff2Html) {
      console.error('Diff2Html is not loaded');
      targetElement.innerHTML = '<div>Error: Diff2Html library not loaded</div>';
      return;
    }
    
    // Use diff2html to render the diff
    const diffHtml = window.Diff2Html.html(currentDiff, {
      drawFileList: true,
      outputFormat: 'side-by-side',
      matching: 'lines'
    });
    
    targetElement.innerHTML = diffHtml;
    
    // Add UI features with Display Full Text button
    addDiff2HtmlUIFeatures(
      targetElement, 
      // Display Full Text callback
      (fileName: string, content: string) => {
        setModalFileName(fileName);
        setModalContent(content);
        setModalOpen(true);
      }
    );

    // Initialize checkbox functionality from our utility and restore any saved state
    setTimeout(() => {
      // Determine filename to pass to initializer: pick first file wrapper's file name
      const $ = (window as any).jQuery || (window as any).$;
      let firstFileName: string | undefined;
      if ($) {
        const wrapper = $(targetElement).find('.d2h-file-wrapper').first();
        if (wrapper && wrapper.length > 0) {
          firstFileName = wrapper.find('.d2h-file-name').text().trim();
        }
      }

      const initial = firstFileName ? checkboxStates[firstFileName] : undefined;
      initializeDiff2HtmlCheckboxes(targetElement, firstFileName, initial, (fileName, currentTexts) => {
        setCheckboxStates(prev => ({ ...prev, [fileName]: currentTexts }));
      });
    }, 200);
  };

  const saveAll = async () => {
    if (!sessionId || !processedData || !diffContainerRef.current || !selectedFile) return;

    try {
      // Extract ONLY the currently visible file
      const currentVisibleFiles = saveAllFiles(diffContainerRef.current);
      
      if (currentVisibleFiles.length === 0) {
        alert('No file is currently visible. Please view a file first.');
        return;
      }
      
      // Send the visible file's content to backend
      const updates = currentVisibleFiles.map(file => ({
        fileName: file.name.replace('{original → new}/', '').replace('original/', '').replace('new/', ''),
        itemId: 0,
        finalText: file.content
      }));

      await axios.post(`${API_BASE_URL}/update-redactions`, {
        session_id: sessionId,
        updates
      });

      // Download just this one file as CSV
      const fileName = selectedFile.replace('.csv', '_redacted.csv');
      window.open(`${API_BASE_URL}/download-single/${sessionId}/${selectedFile}`, '_blank');

      alert(`Downloaded: ${fileName}\n\nThis file includes your checkbox edits.`);
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save file.');
    }
  };

  const deleteSession = async () => {
    if (!sessionId) return;

    const confirmed = confirm(
      'Are you sure you want to delete all data for this session? This action cannot be undone.'
    );

    if (!confirmed) return;

    try {
      const response = await axios.delete(`${API_BASE_URL}/delete-session/${sessionId}`);

      if (response.data.success) {
        alert('All session data has been deleted successfully. You will be returned to Step 1 to start a new session.');
        // Reset to initial state
        setCurrentStep(1);
        setUploadedFiles([]);
        setGroundTruthFiles([]);
        setProcessedData(null);
        setSessionId(null);
        setApiKey('');
        setUseCustomApiKey(false);
        setSelectedFile(null);
        setCurrentDiff('');
        setCheckboxStates({});
      }
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete session data. Please try again.');
    }
  };

  // Update selected file to show diff
  useEffect(() => {
    if (selectedFile && processedData) {
      const fileData = processedData.find(f => f.fileName === selectedFile);
      if (fileData?.diff_file) {
        console.log('Fetching diff file:', fileData.diff_file);
        // Fetch the diff file from the server
        fetch(`${API_BASE_URL}/diff/${fileData.diff_file}`)
          .then(response => response.text())
          .then(diff => {
            setCurrentDiff(diff);
          })
          .catch(error => {
            console.error('Error fetching diff:', error);
          });
      } else {
        console.log('No diff file found for file:', selectedFile);
      }
    }
  }, [selectedFile, processedData]);

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(74deg, #7B004A 16.11%, #CC5803 96.83%)' }}>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center text-white mb-8">
          <div className="flex items-center justify-center gap-4 mb-4">
            {/* <a href="https://rpplpartnership.org/" target="_blank" rel="noopener noreferrer">
              <img src="/rppl-logo.svg" alt="RPPL Logo" className="h-16 w-auto hover:opacity-80 transition-opacity" />
            </a> */}
            <h1 className="text-4xl font-bold">RPPL Redact: Data Privacy Toolkit</h1>
          </div>
          <p className="text-lg opacity-95">Integrated de-identification and redaction review system</p>
        </div>

        {/* Main Container */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Progress Bar */}
          <div className="flex bg-gray-50 border-b">
            {[
              { num: 1, title: 'Upload Files' },
              { num: 2, title: 'Settings' },
              { num: 3, title: 'Results & Review' }
            ].map((step) => (
              <div
                key={step.num}
                className={`flex-1 p-4 text-center cursor-pointer transition-all ${
                  currentStep === step.num ? 'bg-white' :
                  currentStep > step.num ? 'bg-blue-50' : ''
                }`}
                onClick={() => handleStepNavigation(step.num)}
              >
                <div className={`inline-flex items-center justify-center w-8 h-8 rounded-full mb-2 ${
                  currentStep === step.num ? 'bg-blue-600 text-white' :
                  currentStep > step.num ? 'bg-green-500 text-white' : 'bg-gray-300'
                }`}>
                  {currentStep > step.num ? <Check className="w-5 h-5" /> : step.num}
                </div>
                <div className={`text-sm ${currentStep === step.num ? 'font-semibold' : ''}`}>
                  {step.title}
                </div>
              </div>
            ))}
          </div>

          {/* Content Area */}
          <div className="p-8">
            {/* Step 1: Upload Files */}
            {currentStep === 1 && (
              <div>
                <h2 className="text-2xl font-bold mb-6">Step 1: Upload CSV Files</h2>
                
                {/* Instructions Box */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                  <h3 className="font-semibold text-blue-900 mb-2">📋 How It Works</h3>
                  <p className="text-sm text-blue-800 mb-3">
                    Upload your CSV files with any column names. The system will:
                  </p>
                  <div className="bg-white rounded p-3 mb-3">
                    <div className="text-sm text-blue-900 space-y-2">
                      <div>✓ Auto-detect text columns that may contain sensitive information</div>
                      <div>✓ Let you choose which columns to de-identify</div>
                      <div>✓ Generate an ID column if your file doesn't have one</div>
                    </div>
                  </div>
                  <p className="text-sm text-blue-800 mt-3">
                    💡 <strong>Tip:</strong> You can upload multiple files at once, even if they have different columns.
                  </p>
                </div>
                
                <div className="space-y-6">
                  {/* Main Files Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      CSV Files to Process
                    </label>
                    <div
                      className={`border-2 border-dashed rounded-lg p-8 text-center bg-gray-50 ${isDraggingMain ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}
                      onDrop={(e) => handleDrop(e, false)}
                      onDragOver={(e) => handleDragOver(e, false)}
                      onDragLeave={(e) => handleDragLeave(e, false)}
                    >
                      <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                      <input
                        type="file"
                        multiple
                        accept=".csv"
                        onChange={(e) => handleFileUpload(e, false)}
                        className="hidden"
                        id="file-upload"
                      />
                      <label htmlFor="file-upload" className="cursor-pointer">
                        <span className="text-blue-600 hover:text-blue-700 font-medium">
                          Click to upload
                        </span>
                        <span className="text-gray-600"> or drag and drop</span>
                      </label>
                      <p className="text-sm text-gray-500 mt-2">CSV files only (max 10 files)</p>
                    </div>
                  </div>

                  {uploadedFiles.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">Uploaded Files ({uploadedFiles.length})</h3>
                        <div className="text-sm text-gray-600">
                          Total: {(uploadedFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(2)} MB
                          {uploadedFiles.reduce((sum, f) => sum + f.size, 0) > 5 * 1024 * 1024 && (
                            <span className="ml-2 text-orange-600 font-medium">⚠️ Large file - may take time</span>
                          )}
                        </div>
                      </div>
                      {uploadedFiles.map((file) => (
                        <div key={file.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <FileText className="w-8 h-8 text-blue-600" />
                            <div>
                              <div className="font-medium">{file.name}</div>
                              <div className="text-sm text-gray-500">{(file.size / 1024).toFixed(2)} KB</div>
                            </div>
                          </div>
                          <button
                            onClick={() => removeFile(file.name, false)}
                            className="text-red-500 hover:text-red-700 font-bold px-2 py-1"
                            aria-label={`Remove ${file.name}`}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-center mt-8">
                  <button
                    onClick={async () => {
                      if (uploadedFiles.length > 0 && !sessionId) {
                        // Upload files and fetch column info before proceeding
                        try {
                          await uploadFilesToServer();
                        } catch (error) {
                          alert('Failed to upload files. Please try again.');
                          return;
                        }
                      }
                      setCurrentStep(2);
                    }}
                    disabled={uploadedFiles.length === 0}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Settings */}
            {currentStep === 2 && (
              <div>
                <h2 className="text-2xl font-bold mb-6">Step 2: Configuration</h2>
                
                {/* API Key Configuration */}
                <div className="bg-gray-50 rounded-lg p-6 mb-6">
                  <h3 className="text-lg font-semibold mb-4">API Configuration</h3>

                  {/* Show current model configuration if local model is detected */}
                  {apiConfig && apiConfig.is_local_model && (
                    <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded">
                      <div className="flex items-start gap-2">
                        <span className="text-green-600 font-semibold">✓</span>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-green-900">Local Model Configured</p>
                          <p className="text-sm text-green-800 mt-1">
                            <strong>Model:</strong> {apiConfig.model}
                          </p>
                          <p className="text-sm text-green-800">
                            <strong>Endpoint:</strong> {apiConfig.base_url}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Toggle for custom API key */}
                  <label className="flex items-center gap-3 cursor-pointer mb-4">
                    <input
                      type="checkbox"
                      checked={useCustomApiKey}
                      onChange={(e) => {
                        setUseCustomApiKey(e.target.checked);
                        if (!e.target.checked) {
                          setApiKey(''); // Clear custom key when unchecking
                        }
                      }}
                      className="w-5 h-5"
                    />
                    <span>Use Custom API Key (optional)</span>
                  </label>

                  {useCustomApiKey && (
                    <>
                      <div className="flex gap-3">
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder="Enter your OpenAI API key"
                          className="flex-1 px-4 py-2 border rounded-lg"
                        />
                      </div>
                      <p className="text-sm text-gray-600 mt-2">Enter your own OpenAI API key for processing</p>
                    </>
                  )}

                  {!useCustomApiKey && !apiConfig?.is_local_model && (
                    <p className="text-sm text-gray-600">Using default OpenAI API key configured in the environment</p>
                  )}

                  {/* Informational note about local models */}
                  {!apiConfig?.is_local_model && (
                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm">
                      <p className="text-blue-900">
                        <strong>Advanced:</strong> Want to use local LLMs (Ollama or LM Studio) instead of OpenAI?
                        See the <a href="https://github.com/learning-data-insights/rppl-privacy-toolkit-ref" style={{ textDecoration: 'underline', color: 'blue' }} target="_blank" rel="noopener noreferrer">README file</a> (section "Docker with Local LLMs") for setup instructions.
                      </p>
                    </div>
                  )}
                </div>

                {/* Column Selection */}
                {availableColumns.length > 0 && (
                  <div className="bg-gray-50 rounded-lg p-6 mb-6">
                    <h3 className="text-lg font-semibold mb-4">Select Columns to De-identify</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      The system has pre-selected text columns that may contain sensitive information. Please review and adjust your selection as needed.
                    </p>

                    <div className="space-y-3 max-h-64 overflow-y-auto">
                      {availableColumns.map((col) => (
                        <label
                          key={col.name}
                          className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
                            selectedColumns.includes(col.name)
                              ? 'bg-blue-50 border-blue-300'
                              : 'bg-white border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedColumns.includes(col.name)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedColumns([...selectedColumns, col.name]);
                              } else {
                                setSelectedColumns(selectedColumns.filter(c => c !== col.name));
                              }
                            }}
                            className="mt-1 w-5 h-5"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{col.name}</span>
                              {col.recommended && (
                                <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded">
                                  Auto-detected
                                </span>
                              )}
                              {col.filesWithColumn && col.filesWithColumn.length > 0 && (
                                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                  {col.filesWithColumn.length} file{col.filesWithColumn.length > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Type: {col.type}
                            </div>
                            {col.filesWithColumn && col.filesWithColumn.length > 0 && col.filesWithColumn.length <= 3 && (
                              <div className="text-xs text-gray-500 mt-1">
                                Files: {col.filesWithColumn.join(', ')}
                              </div>
                            )}
                            {col.sample && (
                              <div className="text-xs text-gray-600 mt-1 p-2 bg-gray-100 rounded">
                                Sample: {col.sample}
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>

                    {selectedColumns.length === 0 && (
                      <div className="mt-3 text-sm text-amber-600 bg-amber-50 border border-amber-200 p-2 rounded">
                        ⚠️ Please select at least one column to process
                      </div>
                    )}

                    <div className="mt-3 text-sm text-gray-600">
                      {selectedColumns.length} column(s) selected for de-identification
                    </div>
                  </div>
                )}

                {/* Ground Truth Configuration */}
                <div className="bg-gray-50 rounded-lg p-6 mb-6">
                  <h3 className="text-lg font-semibold mb-4">Ground Truth Files</h3>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasGroundTruth}
                      onChange={(e) => setHasGroundTruth(e.target.checked)}
                      className="w-5 h-5"
                    />
                    <span>Add Ground Truth files for evaluation</span>
                  </label>
                  
                  {hasGroundTruth && (
                    <>
                      <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                        <strong>Required Column:</strong> Ground truth files must include a column named <code className="bg-yellow-100 px-2 py-0.5 rounded font-semibold">post_text_human_redacted</code>
                      </div>
                      <div
                        className={`mt-4 ${isDraggingGT ? 'border border-yellow-400 bg-yellow-50 p-4 rounded' : ''}`}
                        onDrop={(e) => handleDrop(e, true)}
                        onDragOver={(e) => handleDragOver(e, true)}
                        onDragLeave={(e) => handleDragLeave(e, true)}
                      >
                      <input
                        type="file"
                        multiple
                        accept=".csv"
                        onChange={(e) => handleFileUpload(e, true)}
                        className="hidden"
                        id="gt-file-upload"
                      />
                      <label htmlFor="gt-file-upload" className="cursor-pointer inline-block px-4 py-2 bg-yellow-500 text-yellow-900 rounded-lg hover:bg-yellow-400 transition-colors">
                        Upload Ground Truth Files
                      </label>
                      
                      {groundTruthFiles.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <div className="text-sm text-yellow-800">{groundTruthFiles.length} ground truth file(s) uploaded</div>
                          <div className="space-y-2">
                            {groundTruthFiles.map(gt => (
                              <div key={gt.name} className="flex items-center justify-between p-2 bg-yellow-50 border border-yellow-100 rounded">
                                <div className="text-sm text-yellow-800">{gt.name}</div>
                                <button onClick={() => removeFile(gt.name, true)} className="text-red-600 hover:text-red-800 px-2">✕</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Show filename mismatch errors if any */}
                      {mismatchError && (
                        <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 p-2 rounded">
                          {mismatchError}
                        </div>
                      )}
                      </div>
                    </>
                  )}
                </div>

                {/* Prompt Selection */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h3 className="text-lg font-semibold mb-4">Prompt Selection</h3>
                  <div className="space-y-3">
                    {availablePrompts.map(prompt => (
                      <label key={prompt.id} className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name="prompt"
                          value={prompt.id}
                          checked={selectedPromptId === prompt.id}
                          onChange={() => setSelectedPromptId(prompt.id)}
                          className="mt-1"
                        />
                        <div>
                          <div className="font-medium">{prompt.name}</div>
                          <div className="text-sm text-gray-600 mt-1">{prompt.text.substring(0, 100)}...</div>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="mt-4">
                    <button
                      onClick={() => {
                        const selected = availablePrompts.find(p => p.id === selectedPromptId) || null;
                        setEditingPrompt(selected);
                        setEditPromptOpen(true);
                      }}
                      className="px-4 py-2 mt-3 bg-yellow-500 text-yellow-900 rounded hover:bg-yellow-400"
                    >
                      Edit Selected Prompt
                    </button>
                  </div>
                </div>

                <div className="flex justify-center gap-4 mt-8">
                  <button
                    onClick={() => {
                      // Clear session-related state when going back to allow file changes
                      setSessionId(null);
                      setProcessedData(null);
                      setCurrentDiff('');
                      setSelectedFile(null);
                      setAvailableColumns([]);
                      setSelectedColumns([]);
                      setCurrentStep(1);
                    }}
                    className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                    disabled={processing}
                  >
                    Back
                  </button>
                  <button
                    onClick={processFiles}
                    disabled={processing || (useCustomApiKey && !apiKey) || (hasGroundTruth && !!mismatchError) || selectedColumns.length === 0}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {processing ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Processing...
                      </>
                    ) : (
                      'Process Files'
                    )}
                  </button>
                </div>
                
                {/* Processing Status */}
                {processing && processingStatus && (
                  <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                      <div>
                        <p className="text-blue-900 font-medium">{processingStatus}</p>
                        <p className="text-sm text-blue-700 mt-1">
                        Large files may take several minutes to process.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Results & Review */}
            {currentStep === 3 && processedData && (
              <div>
                <h2 className="text-2xl font-bold mb-6">Step 3: Results & Redaction Review</h2>
                
                {/* Collapsible Instructions Box */}
                <details className="bg-blue-50 border border-blue-200 rounded-lg mb-6" open>
                  <summary className="font-semibold text-blue-900 p-4 cursor-pointer hover:bg-blue-100 rounded-t-lg">
                    📝 How to Review & Download
                  </summary>
                  <div className="px-4 pb-4 text-sm text-blue-800 space-y-2">
                    <p>
                      <strong>1. Review Redactions:</strong> The diff view shows original text (left) and redacted text (right) side-by-side.
                      <span className="italic"> Only rows with changes are displayed.</span>
                    </p>
                    <p>
                      <strong>2. Customize (Optional):</strong> Click checkboxes next to redactions to undo them (keep original text instead).
                    </p>
                    <p>
                      <strong>3. Download:</strong> Click <span className="font-semibold">"Save & Download"</span> to get your final CSV. Each column will have:
                    </p>
                    <ul className="list-disc ml-6 text-blue-800">
                      <li><code className="bg-blue-100 px-1 rounded">column_name</code> — Original text</li>
                      <li><code className="bg-blue-100 px-1 rounded">column_name_OpenAI_redacted</code> — AI-generated redactions</li>
                      <li><code className="bg-blue-100 px-1 rounded">column_name_user_edited</code> — Populated only for rows where you unchecked redactions</li>
                    </ul>
                  </div>
                </details>
                
                {/* Metrics Table */}
                {processedData.some(d => d.metrics) && (
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold mb-4">Performance Metrics</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-blue-600 text-white">
                            <th className="p-3 text-left">File Name</th>
                            <th className="p-3 text-center">Accuracy</th>
                            <th className="p-3 text-center">Precision</th>
                            <th className="p-3 text-center">Recall</th>
                            <th className="p-3 text-center">Kappa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {processedData.map((file, idx) => (
                            <tr key={idx} className="border-b hover:bg-gray-50">
                              <td className="p-3">{file.fileName}</td>
                              <td className="p-3 text-center font-semibold text-green-600">
                                {file.metrics?.accuracy.toFixed(3) || '-'}
                              </td>
                              <td className="p-3 text-center font-semibold text-green-600">
                                {file.metrics?.precision.toFixed(3) || '-'}
                              </td>
                              <td className="p-3 text-center font-semibold text-green-600">
                                {file.metrics?.recall.toFixed(3) || '-'}
                              </td>
                              <td className="p-3 text-center font-semibold text-green-600">
                                {file.metrics?.kappa.toFixed(3) || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Redaction Interface */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold">Redaction Review</h3>
                  </div>

                  {/* File Tabs */}
                  {processedData.length > 1 && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-600 mb-2">
                        {processedData.length} files processed. Click tabs to switch between files:
                      </p>
                      <div className="flex gap-2 border-b">
                        {processedData.map((file) => (
                          <button
                            key={file.fileName}
                            onClick={() => {
                              setSelectedFile(file.fileName);
                              if (currentDiff && diffContainerRef.current) {
                                setTimeout(() => renderDiff2Html(), 100);
                              }
                            }}
                            className={`px-4 py-2 font-medium transition-colors ${
                              selectedFile === file.fileName
                                ? 'border-b-2 border-blue-600 text-blue-600'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            {file.fileName}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Diff View using diff2html */}
                  <div ref={diffContainerRef} className="bg-white rounded-lg p-4 overflow-auto" style={{ maxHeight: '600px' }}>
                    {!currentDiff && selectedFile && (
                      <div className="text-gray-500 text-center py-8">
                        Loading diff view...
                      </div>
                    )}
                  </div>

                  <div className="flex justify-center gap-4 mt-6">
                    <button
                      onClick={() => {
                        // Clear results state when returning to allow re-processing
                        setProcessedData(null);
                        setCurrentDiff('');
                        setSelectedFile(null);
                        setCurrentStep(2);
                      }}
                      className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      Return
                    </button>
                    <button
                      onClick={saveAll}
                      className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      Save & Download
                    </button>
                    <button
                      onClick={deleteSession}
                      className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Finish and Delete Data
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <footer className="text-center text-white py-8 mt-8">
        <div className="container mx-auto px-4">
          <p className="text-base mb-6 max-w-4xl mx-auto">
            This interface was developed by{' '}
            <a href="https://www.learningdatainsights.com/" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80 transition-opacity">
              Learning Data Insights
            </a>
            , building on research and development from the{' '}
            <a href="https://learninganalytics.upenn.edu/" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80 transition-opacity">
              Penn Center for Learning Analytics
            </a>
            {' '}at the{' '}
            <a href="https://www.upenn.edu/" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80 transition-opacity">
              University of Pennsylvania
            </a>
            , and the{' '}
            <a href="https://rpplpartnership.org/" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80 transition-opacity">
              Research Partnership for Professional Learning
            </a>
            .
          </p>

          {/* Logos */}
          <div className="flex justify-center items-center gap-8 mb-6 flex-wrap">
            <a href="https://www.learningdatainsights.com/" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
              <img src="/LDI_transparent_logo.png" alt="Learning Data Insights Logo" className="h-16 w-auto bg-white rounded px-3 py-2" />
            </a>
            <a href="https://rpplpartnership.org/" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
              <img src="/RPPL_Primary_Logo-Wine.png" alt="RPPL Logo" className="h-16 w-auto bg-white rounded px-3 py-2" />
            </a>
            <a href="https://www.upenn.edu/" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
              <img src="/pennlogo-large.png" alt="University of Pennsylvania Logo" className="h-16 w-auto bg-white rounded px-3 py-2" />
            </a>
            <a href="https://learninganalytics.upenn.edu/" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
              <img src="/PCLA_logo.png" alt="Penn Center for Learning Analytics Logo" className="h-16 w-auto bg-white rounded px-3 py-2" />
            </a>
          </div>

          {/* Copyright and Terms */}
          <p className="text-sm opacity-90">
            &copy; {new Date().getFullYear()} Learning Data Insights. All rights reserved.{' '}
            Learn more in our{' '}
            <a
              href="https://docs.google.com/document/d/19auj_WrbWpE9A6MFJlVZHBS2TyF9hk3dNCPQIPjtSe8/edit?usp=sharing"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-200 transition-colors"
            >
            Terms of Use
            </a>.
          </p>
        </div>
      </footer>

      {/* Changes Modal */}
      <ChangesModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        content={modalContent}
        fileName={modalFileName}
      />

      <EditPromptModal
        isOpen={editPromptOpen}
        prompt={editingPrompt}
        onClose={() => setEditPromptOpen(false)}
        onSave={handleSavePrompt}
      />
    </div>
  );
}

export default App;