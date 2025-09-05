/**
 * Utility to map [REDACTED] tags to original text and create interactive checkboxes
 * This approach works backwards from the redacted text to find what was removed
 */

interface RedactionMapping {
  redactedIndex: number;
  originalText: string;
  startPos: number;
  endPos: number;
}

/**
 * Find the original text that corresponds to each [REDACTED] tag
 * by comparing the redacted text with the original text
 */
export function findRedactionMappings(originalText: string, redactedText: string): RedactionMapping[] {
  const mappings: RedactionMapping[] = [];
  const redactedTag = '[REDACTED]';
  
  // Split both texts into words/tokens for better matching
  const originalWords = originalText.split(/(\s+|[,.:;!?])/);
  const redactedWords = redactedText.split(/(\s+|[,.:;!?])/);
  
  let origIndex = 0;
  let redIndex = 0;
  let redactionCount = 0;
  
  while (redIndex < redactedWords.length && origIndex < originalWords.length) {
    const redWord = redactedWords[redIndex];
    
    if (redWord === redactedTag) {
      // Found a [REDACTED] - need to find what it replaced
      const startOrigIndex = origIndex;
      
      // Look ahead to find the next matching word after [REDACTED]
      let nextMatchWord = '';
      let nextRedIndex = redIndex + 1;
      
      // Find the next non-whitespace word in redacted text
      while (nextRedIndex < redactedWords.length) {
        if (redactedWords[nextRedIndex].trim()) {
          nextMatchWord = redactedWords[nextRedIndex];
          break;
        }
        nextRedIndex++;
      }
      
      // Find where this word appears in the original
      let endOrigIndex = origIndex;
      let foundMatch = false;
      
      if (nextMatchWord) {
        // Look for the next matching word in original
        while (endOrigIndex < originalWords.length) {
          if (originalWords[endOrigIndex] === nextMatchWord) {
            foundMatch = true;
            break;
          }
          endOrigIndex++;
        }
      } else {
        // [REDACTED] is at the end, consume rest of original
        endOrigIndex = originalWords.length;
        foundMatch = true;
      }
      
      if (foundMatch) {
        // Extract the original text that was redacted
        const originalSnippet = originalWords.slice(startOrigIndex, endOrigIndex).join('');
        
        mappings.push({
          redactedIndex: redactionCount,
          originalText: originalSnippet.trim(),
          startPos: startOrigIndex,
          endPos: endOrigIndex
        });
        
        origIndex = endOrigIndex;
        redactionCount++;
      } else {
        // Couldn't find a match, skip this [REDACTED]
        origIndex++;
      }
      
      redIndex++;
    } else if (redWord === originalWords[origIndex]) {
      // Words match, continue
      redIndex++;
      origIndex++;
    } else if (!redWord.trim() && !originalWords[origIndex].trim()) {
      // Both are whitespace, continue
      redIndex++;
      origIndex++;
    } else {
      // Mismatch - this might be a non-redacted change like "somee" -> "some"
      // Try to resync by looking ahead
      let resyncFound = false;
      
      // Look for the next matching word
      for (let lookAhead = 1; lookAhead < 5 && origIndex + lookAhead < originalWords.length; lookAhead++) {
        if (originalWords[origIndex + lookAhead] === redWord) {
          origIndex += lookAhead;
          resyncFound = true;
          break;
        }
      }
      
      if (!resyncFound) {
        // Try the other direction - maybe the redacted version has extra
        for (let lookAhead = 1; lookAhead < 5 && redIndex + lookAhead < redactedWords.length; lookAhead++) {
          if (redactedWords[redIndex + lookAhead] === originalWords[origIndex]) {
            redIndex += lookAhead;
            resyncFound = true;
            break;
          }
        }
      }
      
      if (!resyncFound) {
        // Skip both and continue
        redIndex++;
        origIndex++;
      }
    }
  }
  
  return mappings;
}

/**
 * Initialize the new checkbox system that creates DEL tags dynamically
 */
export function initializeRedactionCheckboxes(container: HTMLElement): void {
  const $ = (window as any).jQuery || (window as any).$;
  if (!$) {
    console.error('jQuery is required for checkbox functionality');
    return;
  }
  
  // Process each diff block
  $(container).find('.d2h-file-wrapper').each(function(this: any) {
    const fileWrapper = $(this);
    
    // Get all the lines with INS tags (redacted version)
    fileWrapper.find('.d2h-ins .d2h-code-line-ctn').each(function(this: any) {
      const lineElement = $(this);
      const lineHtml = lineElement.html();
      
      // Check if this line has [REDACTED]
      if (!lineHtml || !lineHtml.includes('[REDACTED]')) {
        return;
      }
      
      // Find the corresponding original line (in the del section)
      const lineNumber = lineElement.closest('tr').find('.d2h-code-linenumber').first().text();
      const delLine = fileWrapper.find('.d2h-del .d2h-code-linenumber:contains("' + lineNumber + '")').closest('tr').find('.d2h-code-line-ctn');
      
      if (delLine.length === 0) {
        return;
      }
      
      // Extract text content (remove HTML tags)
      const redactedText = lineElement.text();
      const originalText = delLine.text();
      
      // Find mappings
      const mappings = findRedactionMappings(originalText, redactedText);
      
      // For each mapping, create an interactive element
      mappings.forEach((mapping, index) => {
        // Create a unique ID for this redaction
        const redactionId = `redaction-${Date.now()}-${index}`;
        
        // Replace [REDACTED] in the INS line with a span that can be updated
        const insHtml = lineElement.html();
        const newInsHtml = insHtml.replace('[REDACTED]', `<span class="redacted-text" data-id="${redactionId}">[REDACTED]</span>`);
        lineElement.html(newInsHtml);
        
        // Add DEL tag and checkbox to the original line
        if (mapping.originalText) {
          const escapedText = $('<div>').text(mapping.originalText).html();
          const checkboxHtml = `<input type="checkbox" class="insert-checkbox" data-id="${redactionId}" data-original="${escapedText}" style="margin-left: 3px;" />`;

          // Use a more robust way to wrap text, even across nodes
          const textNodes: Node[] = [];
          const walk = document.createTreeWalker(delLine[0], NodeFilter.SHOW_TEXT, null);
          let node;
          while(node = walk.nextNode()) {
            if (node.textContent && node.textContent.trim() !== '') {
              textNodes.push(node);
            }
          }

          let found = false;
          for (const textNode of textNodes) {
            if (textNode.textContent && textNode.textContent.includes(mapping.originalText)) {
              const parts = textNode.textContent.split(mapping.originalText);
              const parent = textNode.parentNode;
              if (parent) {
                const del = document.createElement('del');
                del.textContent = mapping.originalText;
                
                parent.insertBefore(document.createTextNode(parts[0]), textNode);
                parent.insertBefore(del, textNode);
                
                const remainingText = document.createTextNode(parts.slice(1).join(mapping.originalText));
                parent.insertBefore(remainingText, textNode);
                
                parent.removeChild(textNode);

                // Insert checkbox after the new <del> element
                $(del).after(checkboxHtml);
                found = true;
                break;
              }
            }
          }

          if (!found) {
            // Fallback for simple cases or if DOM walking fails
            const delHtml = delLine.html();
            if (delHtml.includes(mapping.originalText)) {
              const newDelHtml = delHtml.replace(
                mapping.originalText,
                `<del>${mapping.originalText}</del>${checkboxHtml}`
              );
              delLine.html(newDelHtml);
            }
          }
          
          // Add checkbox handler
          delLine.find(`input[data-id="${redactionId}"]`).on('change', function(this: any) {
            const checkbox = $(this);
            const targetSpan = lineElement.find(`span[data-id="${redactionId}"]`);
            
            if (checkbox.is(':checked')) {
              targetSpan.text(mapping.originalText);
            } else {
              targetSpan.text('[REDACTED]');
            }
          });
        }
      });
    });
  });
  
  console.log('Redaction checkboxes initialized with new approach');
}

/**
 * Alternative simpler approach - work directly with the diff2html output
 */
export function initializeSimpleRedactionCheckboxes(container: HTMLElement): void {
  const $ = (window as any).jQuery || (window as any).$;
  if (!$) {
    console.error('jQuery is required');
    return;
  }
  
  // Find all INS elements with [REDACTED]
  const redactedElements: any[] = [];
  $(container).find('ins').each(function(this: any) {
    const text = $(this).text();
    if (text.includes('[REDACTED]')) {
      redactedElements.push(this);
    }
  });
  
  console.log(`Found ${redactedElements.length} elements with [REDACTED]`);
  
  // For each [REDACTED], find the best matching DEL
  redactedElements.forEach((insElement, index) => {
    const $ins = $(insElement);
    
    // Find the corresponding DEL line by position
    const insRow = $ins.closest('tr');
    const insLineNum = insRow.find('.d2h-code-linenumber').text();
    
    // Look for DEL elements in a reasonable range
    const possibleDels: any[] = [];
    
    $(container).find('del').each(function(this: any) {
      const $del = $(this);
      const delRow = $del.closest('tr');
      const delLineNum = delRow.find('.d2h-code-linenumber').text();
      
      // Check if line numbers are close
      if (Math.abs(parseInt(delLineNum) - parseInt(insLineNum)) <= 2) {
        possibleDels.push(this);
      }
    });
    
    if (possibleDels.length > 0) {
      // Use the first matching DEL (or merge if multiple)
      let originalText = '';
      const $firstDel = $(possibleDels[0]);
      
      // Check if multiple DELs should be merged (Belfast,London case)
      if (possibleDels.length > 1) {
        // Check if they're on the same line and close together
        const firstParent = $firstDel.parent()[0];
        let shouldMerge = true;
        
        possibleDels.forEach((del, i) => {
          if (i > 0 && $(del).parent()[0] !== firstParent) {
            shouldMerge = false;
          }
        });
        
        if (shouldMerge) {
          // Merge the text from all DELs
          possibleDels.forEach(del => {
            originalText += $(del).text();
          });
        } else {
          originalText = $firstDel.text();
        }
      } else {
        originalText = $firstDel.text();
      }
      
      // Create checkbox after the first DEL
      const checkboxId = `check-${index}`;
      const checkbox = $(`<input type="checkbox" class="insert-checkbox" id="${checkboxId}" style="margin-left: 3px;" />`);
      $firstDel.after(checkbox);
      
      // Handle checkbox change
      checkbox.on('change', function(this: HTMLInputElement) {
        if ($(this).is(':checked')) {
          $ins.text(originalText);
        } else {
          $ins.text('[REDACTED]');
        }
      });
    }
  });
}