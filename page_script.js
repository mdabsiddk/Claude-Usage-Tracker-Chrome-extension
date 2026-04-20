// page_script.js - Injected into the Claude.ai DOM context
// This intercepts fetch API to detect when a message is successfully sent to Claude.

(function() {
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const opts = args[1] || {};
    const method = (opts.method || (args[0] instanceof Request ? args[0].method : 'GET')).toUpperCase();

    // Check if the request is a chat completion / append_message POST request
    const isMessageRequest = url && 
        url.includes('/api/organizations/') && 
        url.includes('/chat_conversations') && 
        method === 'POST';

    try {
      const response = await originalFetch.apply(this, args);
      
      // If it's a message POST and successful (200 OK), notify the content script
      if (isMessageRequest && response.ok) {
        window.postMessage({ type: 'CUT_CLAUDE_MESSAGE_SENT_SUCCESS' }, '*');
      }
      return response;
    } catch (err) {
      throw err;
    }
  };

  console.log('[CUT] Injector initialized. Fetch patched for monitoring.');
})();
