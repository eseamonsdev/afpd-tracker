(() => {
  function selectCommands(code){
    const range=document.createRange();range.selectNodeContents(code);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
  }
  for(const button of document.querySelectorAll('[data-copy-target]')){
    const code=document.getElementById(button.dataset.copyTarget);
    if(!code)continue;
    const status=button.closest('.command-panel').querySelector('.command-copy-status');
    button.hidden=false;
    button.addEventListener('click',async()=>{
      button.disabled=true;status.textContent='';
      try{
        try{
          if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(code.textContent);
        }catch{
          selectCommands(code);
          if(!document.execCommand?.('copy'))throw new Error('Manual copy needed');
          window.getSelection().removeAllRanges();
        }
        status.textContent='Commands copied.';button.textContent='Copied';
      }catch{
        selectCommands(code);status.textContent='Commands selected. Press Ctrl+C or ⌘C to copy.';
      }finally{button.disabled=false;}
    });
  }
  function revealTask(){
    const task=document.getElementById(location.hash.slice(1));
    if(task?.tagName==='DETAILS')task.open=true;
  }
  window.addEventListener('hashchange',revealTask);revealTask();
})();
