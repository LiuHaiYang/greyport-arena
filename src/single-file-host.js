(() => {
  'use strict';
  function command(room,map) {
    const source = new URL(window.location.href);
    if (source.protocol !== 'file:') return '';
    const target=new URLSearchParams();
    target.set('room',room||source.searchParams.get('room')||'灰港');
    target.set('map',map||source.searchParams.get('map')||'dock');
    const query=target.toString();
    source.hash = '';
    source.search = '';
    // Pass a file URI so Windows can resolve drive letters, UNC paths and escaped characters.
    // PowerShell string delimiters are escaped even when the browser leaves them in a URL.
    const fileUri = source.href.replace(/'/g, '%27');
    const typeName = '__GREYPORT_HOST_TYPE__';
    const dataBlock = '(?s)<' + 'script id="greyport-lobby" type="text/plain">(.*?)<' + '/script>';
    return [
      "$greyportHtml=[IO.File]::ReadAllText(([uri]'" + fileUri + "').LocalPath)",
      "$greyportCode=[regex]::Match($greyportHtml,'" + dataBlock + "').Groups[1].Value",
      "if(-not ('" + typeName + "' -as [type])){Add-Type -ErrorAction Stop -ReferencedAssemblies System.dll,System.Core.dll,System.Web.dll,System.Web.Extensions.dll -TypeDefinition $greyportCode}",
      "$greyportServer=[" + typeName + "]::OpenMatch($greyportHtml,'0.0.0.0',8787,$true,'"+query+"')",
      "if ($null -ne $greyportServer) { try { [void](Read-Host '按回车结束联机') } finally { $greyportServer.Dispose() } }"
    ].join('; ');
  }
  window.SingleFileHost = Object.freeze({command});
})();
