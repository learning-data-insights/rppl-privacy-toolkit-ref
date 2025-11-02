import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, Upload, FileText, Check, Save, Trash2 } from 'lucide-react';
import axios from 'axios';
import { initializeDiff2HtmlCheckboxes, saveAllFiles, addDiff2HtmlUIFeatures } from './utils/diff2htmlCheckbox';
import ChangesModal from './components/ChangesModal';
import EditPromptModal from './components/EditPromptModal';

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
  const [processedData, setProcessedData] = useState<ProcessedResult[] | null>(null);
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const [currentDiff, setCurrentDiff] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
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

  const handleSavePrompt = async (updated: Prompt) => {
    // Create a new session-only Custom Prompt and select it
    const customPrompt: Prompt = {
      id: Date.now(),
      name: 'Custom Prompt',
      text: updated.text
    };
    setAvailablePrompts(prev => [customPrompt, ...prev]);
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

  // Load available prompts on mount
  useEffect(() => {
    loadPrompts();
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
      const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      setSessionId(response.data.session_id);
      return response.data.session_id;
    } catch (error) {
      console.error('Upload failed:', error);
      throw error;
    }
  };

  const processFiles = async () => {
    if (!apiKey) {
      alert('Please enter your OpenAI API key');
      return;
    }

    setProcessing(true);
    
    try {
      // First upload files
      const newSessionId = await uploadFilesToServer();
      
      // Get the selected prompt
      const selectedPrompt = availablePrompts.find(p => p.id === selectedPromptId) || null;

      // If user selected a session-only Custom Prompt, send prompt_text only and omit prompt_index
      let payload: any = { session_id: newSessionId, api_key: apiKey };
      if (selectedPrompt) {
        if (selectedPrompt.name === 'Custom Prompt') {
          // Custom session-only prompt: send only prompt_text (backend will use it)
          payload.prompt_text = selectedPrompt.text;
        } else {
          // Stored backend prompt: send index (backend expects zero-based index)
          payload.prompt_index = Math.max(0, selectedPrompt.id - 1);
        }
      }

      const response = await axios.post(`${API_BASE_URL}/deidentify`, payload);
      
      const results = response.data.results;
      console.log('Processing results:', results);
      
      setProcessedData(results);
      setProcessing(false);
      setCurrentStep(3);
      
      if (results.length > 0) {
        setSelectedFile(results[0].fileName);
      }
    } catch (error) {
      console.error('Processing failed:', error);
      setProcessing(false);
      alert('Processing failed. Please check your API key and try again.');
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
    if (!sessionId || !processedData || !diffContainerRef.current) return;

    try {
      // Extract all files using the utility function from example
      const allFiles = saveAllFiles(diffContainerRef.current, 'redacted_output');

      if (allFiles.length === 0) {
        alert('No files to save. Please make sure the diff view is loaded.');
        return;
      }

      // Convert to the format expected by the backend
      const updates = allFiles.map(file => ({
        fileName: file.name.replace('new/', '').replace('original/', ''), // Clean up file paths
        itemId: 0,
        finalText: file.content
      }));

      await axios.post(`${API_BASE_URL}/update-redactions`, {
        session_id: sessionId,
        updates
      });

      // Download the results
      window.open(`${API_BASE_URL}/download/${sessionId}`, '_blank');

      alert(`${allFiles.length} file(s) saved and ready for download!`);
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save files.');
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
      console.log('Selected file data:', fileData);
      if (fileData?.diff_file) {
        console.log('Fetching diff file:', fileData.diff_file);
        // Fetch the diff file from the server
        fetch(`${API_BASE_URL}/diff/${fileData.diff_file}`)
          .then(response => response.text())
          .then(diff => {
            console.log('Fetched diff content:', diff.substring(0, 200) + '...');
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
            <h1 className="text-4xl font-bold">Data Privacy Toolkit</h1>
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
                onClick={() => step.num < currentStep && setCurrentStep(step.num)}
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
                      <h3 className="font-semibold">Uploaded Files ({uploadedFiles.length})</h3>
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
                    onClick={() => setCurrentStep(2)}
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
                  <h3 className="text-lg font-semibold mb-4">OpenAI API Key</h3>
                  <div className="flex gap-3">
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Enter your OpenAI API key"
                      className="flex-1 px-4 py-2 border rounded-lg"
                    />
                  </div>
                  <p className="text-sm text-gray-600 mt-2">Required for de-identification processing</p>
                </div>

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
                    onClick={() => setCurrentStep(1)}
                    className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={processFiles}
                    disabled={processing || !apiKey || (hasGroundTruth && !!mismatchError)}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {processing ? 'Processing...' : 'Process Files'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Results & Review */}
            {currentStep === 3 && processedData && (
              <div>
                <h2 className="text-2xl font-bold mb-6">Step 3: Results & Redaction Review</h2>
                
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
                  <div className="flex gap-2 mb-4 border-b">
                    {processedData.map((file) => (
                      <button
                        key={file.fileName}
                        onClick={() => {
                          setSelectedFile(file.fileName);
                          // Force re-render of diff if content exists but wasn't displayed
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
                      onClick={() => setCurrentStep(2)}
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
      <footer className="text-center text-white text-sm py-4 mt-4 opacity-80">
        <p className="text-sm opacity-95">This interface, designed by <a href="https://ld-insights.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-200 transition-colors"> Learning Data Insights</a>, is based on research and development at the <a href="https://www.upenn.edu/" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-200 transition-colors">University of Pennsylvania</a> and <a href="https://rpplpartnership.org/" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-200 transition-colors"> RPPL</a>. This prototype has not yet been fully reviewed. &copy; {new Date().getFullYear()}  </p>
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