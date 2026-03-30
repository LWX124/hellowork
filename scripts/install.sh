#!/bin/bash
# HelloWork 安装脚本 - 安装后自动重新签名（解决 macOS 跨机器签名问题）

APP_DEST="/Applications/HelloWork.app"

echo "正在签名 HelloWork..."

# 签名顺序：从内到外，先签 dylib 和 helper，再签 Electron Framework，最后签主 app
find "$APP_DEST" -name "*.dylib" | xargs -I{} sudo codesign --force --sign - {}
find "$APP_DEST/Contents/Frameworks" -name "*.app" | xargs -I{} sudo codesign --force --sign - {}
sudo codesign --force --sign - "$APP_DEST/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
sudo codesign --force --sign - "$APP_DEST/Contents/Frameworks/Electron Framework.framework"
find "$APP_DEST/Contents/Frameworks" -maxdepth 1 -name "*.framework" ! -name "Electron Framework.framework" | xargs -I{} sudo codesign --force --sign - {}
sudo codesign --force --sign - "$APP_DEST"

if [ $? -eq 0 ]; then
  echo "签名成功，正在启动..."
  open "$APP_DEST"
else
  echo "签名失败，请手动运行签名脚本"
fi
