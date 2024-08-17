import axios from 'axios';
import * as cheerio from 'cheerio';

const function_declarations = [
  {
    name: "web_search",
    parameters: {
      type: "object",
      description: "Search the internet to find up-to-date information on a given topic.",
      properties: {
        query: {
          type: "string",
          description: "The query to search for."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "search_webpage",
    parameters: {
      type: "object",
      description: "Returns a string with all the content of a webpage. Some websites block this, so try a few different websites.",
      properties: {
        url: {
          type: "string",
          description: "The URL of the site to search."
        }
      },
      required: ["url"]
    }
  }
];

async function webSearch(args, name) {
  const query = args.query;
  try {
    const result = await performSearch(query);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            name: name,
            content: result
          }
        }
      }
    ];
    return function_call_result_message;
  } catch (error) {
    const errorMessage = `Error while performing web search: ${error}`;
    console.error(errorMessage);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            name: name,
            content: errorMessage
          }
        }
      }
    ];
    return function_call_result_message;
  }
}

async function searchWebpage(args, name) {
  const url = args.url;
  try {
    const result = await searchWebpageContent(url);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            name: name,
            content: result
          }
        }
      }
    ];
    return function_call_result_message;
  } catch (error) {
    const errorMessage = `Error while searching the site: ${error}`;
    console.error(errorMessage);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            name: name,
            content: errorMessage
          }
        }
      }
    ];
    return function_call_result_message;
  }
}

async function searchWebpageContent(url) {
  const TIMEOUT = 5000; // 5 seconds
  const MIN_CONTENT_LENGTH = 500; // Minimum length for valid content

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out after 5 seconds')), TIMEOUT)
  );

  try {
    const response = await Promise.race([fetch(url), timeoutPromise]);

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    $('script, style').remove();
    let bodyText = $('body').text();

    bodyText = bodyText.replace(/<[^>]*>?/gm, ''); // remove HTML tags
    bodyText = bodyText.replace(/\s{6,}/g, '  '); // replace sequences of 6 or more whitespace characters with 2 spaces
    bodyText = bodyText.replace(/(\r?\n){6,}/g, '\n\n'); // replace sequences of 6 or more line breaks with 2 line breaks

    const trimmedBodyText = bodyText.trim();
    /*
    if (trimmedBodyText.length < MIN_CONTENT_LENGTH) {
      throw new Error('Content is too short; less than 500 characters');
    }
    */

    return trimmedBodyText;
  } catch (error) {
    throw new Error(error.message || 'Could not search content from webpage');
  }
}

async function performSearch(query) {
  const url = `https://search.neuranet-ai.com/search?query=${encodeURIComponent(query)}&limit=5`;

  const response = await axios.get(url)
    .catch(error => {
      throw new Error(`Failed to perform the search request: ${error.message}`);
    });

  const entries = response.data;

  const resultObject = entries.slice(0, 5).map((entry, index) => {
    const title = entry.title;
    const result = entry.snippet;
    const url = entry.link;

    return {
      [`result_${index + 1}`]: { title, result, url }
    };
  });

  const note = {
    "Note": "These are only the search results overview. Please use the Scrape Webpage tool to search further into the links."
  };

  return JSON.stringify(resultObject.reduce((acc, curr) => Object.assign(acc, curr), note), null, 2);
}

async function manageToolCall(toolCall) {
  const tool_calls_to_function = {
    "web_search": webSearch,
    "search_webpage": searchWebpage
  }
  const functionName = toolCall.name;
  const func = tool_calls_to_function[functionName];
  if (func) {
    const args = toolCall.args;
    const result = await func(args, functionName);
    return result;
  } else {
    const errorMessage = `No function found for ${functionName}`;
    console.error(errorMessage);
    const function_call_result_message = [
      {
        functionResponse: {
          name: functionName,
          response: {
            name: functionName,
            content: errorMessage
          }
        }
      }
    ];
    return function_call_result_message;
  }
}

function processFunctionCallsNames(functionCalls) {
  return functionCalls
    .map(tc => {
      if (!tc.name) return '';

      const formattedName = tc.name.split('_')
        .map(word => {
          if (isNaN(word)) {
            return word.charAt(0).toUpperCase() + word.slice(1);
          }
          return word;
        })
        .join(' ');

      const formattedArgs = tc.args ? Object.entries(tc.args)
        .map(([key, value]) => {
          const stringValue = String(value);
          const truncatedValue = stringValue.length > 500 ? stringValue.slice(0, 500) + '...' : stringValue;
          return `${key}: ${truncatedValue}`;
        })
        .join(', ') : '';

      return formattedArgs ? `${formattedName} (${formattedArgs})` : formattedName;
    })
    .filter(name => name)
    .join(', ');
}

export { function_declarations, manageToolCall, processFunctionCallsNames };
