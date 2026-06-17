
  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        headers: options.headers || { 'Content-Type': 'application/json' },
        data: options.data,
        responseType: options.responseType || 'text',
        onload(response) {
          resolve(response);
        },
        onerror(error) {
          reject(error);
        },
      });
    });
  }

  async function apiGet(path) {
    const response = await gmRequest({ url: `${SERVER}${path}` });
    if (response.status >= 400) {
      const err = new Error(`GET ${path} failed (${response.status})`);
      err.status = response.status;
      err.body = response.responseText;
      throw err;
    }
    return JSON.parse(response.responseText);
  }

  async function apiPost(path, body) {
    const response = await gmRequest({
      method: 'POST',
      url: `${SERVER}${path}`,
      data: JSON.stringify(body),
    });
    if (response.status >= 400) {
      throw new Error(`POST ${path} failed (${response.status}): ${response.responseText}`);
    }
    return JSON.parse(response.responseText);
  }