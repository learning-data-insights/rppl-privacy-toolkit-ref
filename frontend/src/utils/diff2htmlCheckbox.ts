/**
 * Utility functions for managing diff2html checkbox functionality
 * Adapted from the example implementation
 */

interface TextState {
  insElements: HTMLElement[];
  delTexts: string[];
  currentTexts: string[];
}

/**
 * Initialize checkboxes for diff2html output
 * NEW APPROACH: Start from [REDACTED] tags and work backwards to find original text
 */
export function initializeDiff2HtmlCheckboxes(container: HTMLElement): TextState {
  // Check if jQuery is available
  const $ = (window as any).jQuery || (window as any).$;
  if (!$) {
    console.error('jQuery is required for diff2html checkbox functionality');
    return { insElements: [], delTexts: [], currentTexts: [] };
  }

  // Initialize arrays for storing text content
  const insElements: HTMLElement[] = [];
  const delTexts: string[] = [];
  const currentTexts: string[] = [];

  // Step 1: Find all INS elements that contain [REDACTED]
  const redactedInsElements: { element: HTMLElement, lineText: string }[] = [];
  
  $(container).find('ins').each(function(this: any) {
    const text = $(this).text();
    if (text === '[REDACTED]' || text.includes('[REDACTED]')) {
      redactedInsElements.push({
        element: this,
        lineText: $(this).closest('.d2h-code-line-ctn').text()
      });
      insElements.push(this);
      currentTexts.push('[REDACTED]');
    }
  });

  console.log(`Found ${redactedInsElements.length} [REDACTED] tags to process`);

  // Step 2: For each [REDACTED], find the corresponding original text
  redactedInsElements.forEach((redactedInfo, index) => {
    const $ins = $(redactedInfo.element);
    
    // Get context around the [REDACTED] for better matching
    const insLine = $ins.closest('.d2h-code-line-ctn');
    const insLineText = insLine.text();
    
    // Find words before and after [REDACTED] for context
    const beforeMatch = insLineText.substring(0, insLineText.indexOf('[REDACTED]')).trim().split(/\s+/).pop() || '';
    const afterMatch = insLineText.substring(insLineText.indexOf('[REDACTED]') + '[REDACTED]'.length).trim().split(/\s+/)[0] || '';
    
    console.log(`Looking for redaction with context: "${beforeMatch}" [?] "${afterMatch}"`);
    
    // Find the corresponding DEL elements
    let bestMatch: { element: any, text: string } | null = null;
    let bestScore = 0;
    
    $(container).find('del').each(function(this: any) {
      const $del = $(this);
      const delLine = $del.closest('.d2h-code-line-ctn');
      const delLineText = delLine.text();
      
      // Score this DEL based on context matching
      let score = 0;
      
      // Check if the before/after context matches
      if (beforeMatch && delLineText.includes(beforeMatch)) {
        score += 10;
      }
      if (afterMatch && delLineText.includes(afterMatch)) {
        score += 10;
      }
      
      // Check line proximity (prefer DELs on nearby lines)
      const insRowNum = parseInt($ins.closest('tr').find('.d2h-code-linenumber').first().text()) || 0;
      const delRowNum = parseInt($del.closest('tr').find('.d2h-code-linenumber').first().text()) || 0;
      const distance = Math.abs(insRowNum - delRowNum);
      if (distance <= 3) {
        score += (10 - distance);
      }
      
      // Check if this DEL hasn't been used yet
      if (!$del.hasClass('has-checkbox')) {
        score += 5;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { element: this, text: $del.text() };
      }
    });
    
    // Step 3: If we found a match, check for adjacent DELs that should be merged
    if (bestMatch) {
      const $bestDel = $((bestMatch as { element: any, text: string }).element);
      let mergedText = (bestMatch as { element: any, text: string }).text;
      
      // Check for adjacent DEL elements (Belfast,London case)
      let nextSibling = $bestDel[0].nextSibling;
      while (nextSibling) {
        // Check if there's minimal text between DELs
        if (nextSibling.nodeType === Node.TEXT_NODE) {
          const betweenText = nextSibling.textContent || '';
          if (betweenText.length <= 2 && betweenText.trim().length <= 1) {
            // Small separator (comma, space, etc.)
            const nextElement = nextSibling.nextSibling;
            if (nextElement && nextElement.nodeName === 'DEL') {
              // Merge this DEL
              mergedText += betweenText + $(nextElement).text();
              $(nextElement).addClass('merged-into-previous');
              nextSibling = nextElement.nextSibling;
              continue;
            }
          }
        }
        break;
      }
      
      // Also check previous siblings
      let prevSibling = $bestDel[0].previousSibling;
      let prependText = '';
      while (prevSibling) {
        if (prevSibling.nodeType === Node.TEXT_NODE) {
          const betweenText = prevSibling.textContent || '';
          if (betweenText.length <= 2 && betweenText.trim().length <= 1) {
            const prevElement = prevSibling.previousSibling;
            if (prevElement && prevElement.nodeName === 'DEL') {
              prependText = $(prevElement).text() + betweenText + prependText;
              $(prevElement).addClass('merged-into-next');
              prevSibling = prevElement.previousSibling;
              continue;
            }
          }
        }
        break;
      }
      
      let finalText = prependText + mergedText;
      
      // Clean up trailing punctuation that's likely part of the sentence structure
      // For example: "Belfast,England," should become "Belfast,England"
      if (finalText.endsWith(',,') || finalText.endsWith(',.') || finalText.endsWith(',;')) {
        finalText = finalText.slice(0, -1);
      } else if (finalText.endsWith(',')) {
        // Check if the comma is followed by more text in the original context
        // If the next sibling after our merged DELs is punctuation, remove our trailing comma
        let lastElement = $bestDel[0];
        if ($bestDel.hasClass('has-checkbox')) {
          // Find the last merged element
          let current = lastElement.nextSibling;
          while (current && $(current).hasClass('merged-into-previous')) {
            lastElement = current;
            current = current.nextSibling;
          }
        }
        
        const afterMerged = lastElement.nextSibling;
        if (afterMerged && afterMerged.nodeType === Node.TEXT_NODE) {
          const afterText = (afterMerged.textContent || '').trim();
          if (afterText.startsWith(',') || afterText.startsWith(' ')) {
            // There's already punctuation or space after, remove our trailing comma
            finalText = finalText.slice(0, -1);
          }
        }
      }
      
      delTexts.push(finalText);
      
      // Step 4: Add checkbox only to the main DEL element
      if (!$bestDel.hasClass('has-checkbox') && !$bestDel.hasClass('merged-into-previous') && !$bestDel.hasClass('merged-into-next')) {
        $bestDel.addClass('has-checkbox');
        
        const checkbox = $('<input type="checkbox" class="insert-checkbox" style="margin-left: 3px;" />');
        $bestDel.after(checkbox);
        
        // Checkbox handler
        const currentIndex = index;
        checkbox.on('change', function(this: HTMLInputElement) {
          if ($(this).is(':checked')) {
            $(insElements[currentIndex]).text(finalText);
            currentTexts[currentIndex] = finalText;
          } else {
            $(insElements[currentIndex]).text('[REDACTED]');
            currentTexts[currentIndex] = '[REDACTED]';
          }
        });
      }
    }
  });

  console.log(`Created checkboxes for ${delTexts.length} redactions`);
  
  return { insElements, delTexts, currentTexts };
}

/**
 * Extract final text from diff2html DOM for a specific file wrapper
 */
export function extractFinalTextFromDiff(container: HTMLElement): { [fileName: string]: string } {
  const $ = (window as any).jQuery || (window as any).$;
  if (!$) {
    console.error('jQuery is required for extracting text');
    return {};
  }

  const allFiles: { [fileName: string]: string } = {};

  $(container).find('.d2h-file-wrapper').each(function(this: any) {
    const fileName = $(this).find('.d2h-file-name').text().trim();
    let fileContent = '';

    // Extract content from the inserted (new) lines
    $(this).find('.d2h-ins').find('span.d2h-code-line-ctn').each(function(this: any) {
      const lineElement = $(this).clone();
      
      // Remove checkboxes from the cloned element
      lineElement.find('input.insert-checkbox').remove();
      
      // Get the text content (either redacted or original based on checkbox state)
      const lineText = lineElement.text().trim();
      if (lineText) {
        fileContent += lineText + '\n';
      }
    });

    if (fileName) {
      allFiles[fileName] = fileContent;
    }
  });

  return allFiles;
}

/**
 * Add additional UI features from the example
 */
export function addDiff2HtmlUIFeatures(
  container: HTMLElement, 
  onDisplayFullText?: (fileName: string, content: string) => void
): void {
  const $ = (window as any).jQuery || (window as any).$;
  if (!$ || !(window as any).Diff2HtmlUI) {
    return;
  }

  // Initialize Diff2HtmlUI features
  const diff2htmlUi = new (window as any).Diff2HtmlUI(container);
  diff2htmlUi.fileListToggle(false);
  diff2htmlUi.fileContentToggle();
  diff2htmlUi.synchronisedScroll();
  
  // Add Display Full Text button to each file wrapper (matching example implementation)
  if (onDisplayFullText) {
    $(container).find('.d2h-file-wrapper').each(function(this: any) {
      const fileWrapper = $(this);
      const fileName = fileWrapper.find('.d2h-file-name').text().trim();
      
      // Create button group container
      const buttonGroup = $('<div></div>', { 
        class: 'button-group',
        style: 'display: flex; gap: 10px; margin: 10px; justify-content: flex-end;'
      });
      
      // Create Display Full Text button
      const displayButton = $('<button></button>', {
        type: 'button',
        class: 'submit-btn',
        style: 'padding: 5px 10px; cursor: pointer; background-color: #4CAF50; color: white; border: none; border-radius: 4px;',
        text: 'Display Full Text'
      });
      
      // Handle button click
      displayButton.on('click', function() {
        const fullText = extractFullTextFromFile(fileWrapper[0]);
        onDisplayFullText(fileName, fullText);
      });
      
      buttonGroup.append(displayButton);
      fileWrapper.prepend(buttonGroup);
    });
  }
}

/**
 * Extract full text from a specific file wrapper
 */
export function extractFullTextFromFile(fileWrapper: HTMLElement): string {
  const $ = (window as any).jQuery || (window as any).$;
  if (!$) return '';
  
  let fullText = '';
  
  // Extract text from all inserted (new) lines in the file wrapper
  $(fileWrapper).find('.d2h-ins').find('span.d2h-code-line-ctn').each(function(this: any) {
    const lineElement = $(this).clone();
    
    // Remove checkboxes
    lineElement.find('input.insert-checkbox').remove();
    
    // Get the current text (either redacted or original based on checkbox state)
    const lineText = lineElement.text().trim();
    if (lineText) {
      fullText += lineText + '\n';
    }
  });
  
  return fullText;
}

/**
 * Save all files - extracts the current state of all files
 */
export function saveAllFiles(container: HTMLElement, folderName: string): { name: string; content: string }[] {
  const $ = (window as any).jQuery || (window as any).$;
  if (!$) {
    console.error('jQuery is required for saving files');
    return [];
  }

  const allFiles: { name: string; content: string }[] = [];
  
  $(container).find('.d2h-file-wrapper').each(function(this: any) {
    const fileName = $(this).find('.d2h-file-name').text().trim();
    let fileContent = '';
    
    $(this).find('.d2h-ins').find('span.d2h-code-line-ctn').each(function(this: any) {
      const lineElement = $(this).clone();
      lineElement.find('input.insert-checkbox').remove();
      
      // Get current text (which includes any checkbox-based changes)
      const lineText = lineElement.text().trim();
      if (lineText) {
        fileContent += lineText + '\n';
      }
    });
    
    if (fileName && fileContent) {
      allFiles.push({
        name: fileName,
        content: fileContent
      });
    }
  });
  
  console.log(`Extracted ${allFiles.length} files for folder: ${folderName}`);
  return allFiles;
}