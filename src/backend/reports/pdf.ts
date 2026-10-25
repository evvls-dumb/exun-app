import { BrowserWindow } from 'electron'

const FOOTER = `<div style="width:100%;padding:0 18mm;font:7pt 'Segoe UI',sans-serif;color:#888;display:flex;justify-content:space-between">
  <span>Janus investigation report</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`

export async function renderPdf(html: string): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER
    })
  } finally {
    window.destroy()
  }
}
