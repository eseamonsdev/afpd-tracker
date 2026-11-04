const fs = require('node:fs/promises');
const path = require('node:path');
async function clearDiagnostics(out) {
  for (const name of ['navigation-error-headers.json','navigation-error-body.txt','navigation-error.png','network-diagnostics.json']) {
    await fs.rm(path.join(out,name),{force:true});
  }
}
function requestFailure(request) {
  return {kind:'requestfailed',at:new Date().toISOString(),url:request.url(),method:request.method(),resourceType:request.resourceType(),error:request.failure()?.errorText || 'unknown'};
}
function failedResponse(response) {
  const headers=response.headers();
  return {kind:'http-error',at:new Date().toISOString(),url:response.url(),status:response.status(),headers:Object.fromEntries(['content-type','cf-mitigated','retry-after'].filter(k=>headers[k]).map(k=>[k,headers[k]]))};
}
module.exports={clearDiagnostics,requestFailure,failedResponse};
