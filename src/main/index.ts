// src/main/index.ts
import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron'
import { join } from 'path'
import { ServiceManager } from './service-manager'
import keytar from 'keytar'

const serviceManager = new ServiceManager()
let servicePort: number | null = null

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: true,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  globalShortcut.register('CommandOrControl+Option+I', () => {
    win.webContents.toggleDevTools()
  })
}

app.whenReady().then(async () => {
  try {
    servicePort = await serviceManager.start()
    console.log(`[main] Service started on port ${servicePort}`)
  } catch (err) {
    console.error('[main] Failed to start service:', err)
  }
  await createWindow()
})

ipcMain.handle('service:getPort', () => servicePort)

const KEYCHAIN_SERVICE = 'hellowork'

ipcMain.handle('keychain:set', (_e, account: string, password: string) =>
  keytar.setPassword(KEYCHAIN_SERVICE, account, password)
)
ipcMain.handle('keychain:get', (_e, account: string) =>
  keytar.getPassword(KEYCHAIN_SERVICE, account)
)
ipcMain.handle('keychain:delete', (_e, account: string) =>
  keytar.deletePassword(KEYCHAIN_SERVICE, account)
)

app.on('before-quit', () => {
  serviceManager.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
