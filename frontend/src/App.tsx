import React, { useState, useEffect } from 'react';
import { ChevronRight, Upload, FileText, Check, X, Download, Save, Eye, Settings, AlertCircle } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api';

interface FileData {
  name: string;
  size: number;
  file: File;
}

interface ProcessedResult {
  fileName: string;
  original: any[];
  redacted: any[];
  metrics?: {
    accuracy: number;
    precision: number;
    recall: number;
    kappa: number;
  };
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
  const [customPrompt, setCustomPrompt] = useState('');
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processedData, setProcessedData] = useState<ProcessedResult[] | null>(null);
  const [folderName, setFolderName] = useState('redacted_output');
  const [redactionStates, setRedactionStates] = useState<{[key: string]: boolean[]}>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);

  // Load available prompts on mount
  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/prompts`);
      setAvailablePrompts(response.data);
      if (response.data.length > 0) {
        setCustomPrompt(response.data[0].text);
      }
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

    if (isGroundTruth) {
      setGroundTruthFiles(fileArray);
    } else {
      setUploadedFiles(fileArray);
    }
  };

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
      setShowApiKeyModal(true);
      return;
    }

    setProcessing(true);
    
    try {
      // First upload files
      const newSessionId = await uploadFilesToServer();
      
      // Get the selected prompt
      const selectedPrompt = availablePrompts.find(p => p.id === selectedPromptId);
      const promptIndex = selectedPrompt ? selectedPrompt.id - 1 : 0;
      
      // Process with deidentification
      const response = await axios.post(`${API_BASE_URL}/deidentify`, {
        session_id: newSessionId,
        prompt_index: promptIndex,
        api_key: apiKey
      });
      
      const results = response.data.results;
      
      // Initialize redaction states
      const initialStates: {[key: string]: boolean[]} = {};
      results.forEach((result: ProcessedResult) => {
        result.redacted.forEach((item: any) => {
          const redactedParts = (item.post_text_OpenAI_redacted || item.post_text || '').match(/\[REDACTED\]/g) || [];
          initialStates[`${result.fileName}-${item.id}`] = new Array(redactedParts.length).fill(true);
        });
      });
      
      setProcessedData(results);
      setRedactionStates(initialStates);
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

  const toggleRedaction = (fileId: string, index: number) => {
    setRedactionStates(prev => ({
      ...prev,
      [fileId]: prev[fileId].map((state, i) => i === index ? !state : state)
    }));
  };

  const getProcessedText = (fileName: string, item: any) => {
    const fileId = `${fileName}-${item.id}`;
    const states = redactionStates[fileId] || [];
    const redactedText = item.post_text_OpenAI_redacted || item.post_text || '';
    
    if (states.length === 0) return redactedText;
    
    // For now, return the redacted text as is
    // In a full implementation, you'd apply the checkbox states here
    return redactedText;
  };

  const saveAll = async () => {
    if (!sessionId || !processedData) return;
    
    try {
      // Update redactions on server
      const updates = Object.entries(redactionStates).map(([fileId, states]) => {
        const [fileName, itemId] = fileId.split('-');
        return {
          fileName,
          itemId: parseInt(itemId),
          states
        };
      });
      
      await axios.post(`${API_BASE_URL}/update-redactions`, {
        session_id: sessionId,
        updates
      });
      
      // Download the results
      window.open(`${API_BASE_URL}/download/${sessionId}`, '_blank');
      
      alert(`Files saved and ready for download!`);
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save files.');
    }
  };

  const renderDiffView = (fileName: string, item: any) => {
    const fileId = `${fileName}-${item.id}`;
    const states = redactionStates[fileId] || [];
    const originalText = item.original_text || item.post_text_original || '';
    const redactedText = item.post_text_OpenAI_redacted || item.post_text || '';
    
    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-100 px-4 py-2 font-semibold border-b">Original</div>
          <div className="p-4 font-mono text-sm whitespace-pre-wrap">
            {originalText}
          </div>
        </div>
        
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-100 px-4 py-2 font-semibold border-b flex justify-between items-center">
            <span>Redacted</span>
            <div className="flex gap-2">
              {states.map((isRedacted, idx) => (
                <label key={idx} className="flex items-center gap-1 text-sm font-normal">
                  <input
                    type="checkbox"
                    checked={!isRedacted}
                    onChange={() => toggleRedaction(fileId, idx)}
                    className="w-4 h-4"
                  />
                  <span>Undo {idx + 1}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="p-4 font-mono text-sm whitespace-pre-wrap">
            {redactedText}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-purple-700">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center text-white mb-8">
          <h1 className="text-4xl font-bold mb-2">RPPL Privacy Toolkit</h1>
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
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center bg-gray-50">
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
                      {uploadedFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <FileText className="w-8 h-8 text-blue-600" />
                            <div>
                              <div className="font-medium">{file.name}</div>
                              <div className="text-sm text-gray-500">{(file.size / 1024).toFixed(2)} KB</div>
                            </div>
                          </div>
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
                    <div className="mt-4">
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
                        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                          <div className="text-sm text-yellow-800">
                            {groundTruthFiles.length} ground truth file(s) uploaded
                          </div>
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
                    disabled={processing || !apiKey}
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
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-semibold">Redaction Review</h3>
                    <div className="flex items-center gap-3">
                      <label>Folder name:</label>
                      <input
                        type="text"
                        value={folderName}
                        onChange={(e) => setFolderName(e.target.value)}
                        className="px-3 py-2 border rounded-lg"
                      />
                    </div>
                  </div>

                  {/* File Tabs */}
                  <div className="flex gap-2 mb-4 border-b">
                    {processedData.map((file) => (
                      <button
                        key={file.fileName}
                        onClick={() => setSelectedFile(file.fileName)}
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

                  {/* Diff View */}
                  {selectedFile && (
                    <div className="space-y-6 bg-white rounded-lg p-4 max-h-96 overflow-y-auto">
                      {processedData
                        .find(f => f.fileName === selectedFile)
                        ?.redacted.map((item) => (
                          <div key={item.id} className="border-b pb-4 last:border-0">
                            <div className="text-sm font-semibold text-gray-600 mb-2">
                              Post ID: {item.id}
                            </div>
                            {renderDiffView(selectedFile, item)}
                          </div>
                        ))}
                    </div>
                  )}

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
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;