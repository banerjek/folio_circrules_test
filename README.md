# folio_circrules_test
Chrome extension to check FOLIO circ rules using user and item barcodes

# Loading This Repository as a Chrome Extension (Download ZIP Method)

These instructions explain how to load this repository as an unpacked extension in Google Chrome using the **Download ZIP** method.

---

## 1. Download the Repository

1. Go to the repository page on GitHub
2. Click the green **Code** button
3. Select **Download ZIP**
4. Save the file to your computer
5. Extract the ZIP file
   - On Windows: Right-click → Extract All
   - On macOS: Double-click the ZIP file

After extraction, you should have a folder containing the repository files.

---

## 2. Verify Required Files

Open the extracted folder and confirm it contains:

- `manifest.json` (required)
- `chrome.js` (or other files referenced in the manifest)

Also check:
- `manifest.json` includes `"manifest_version": 2` or `3` (3 is recommended)
- All files referenced inside `manifest.json` exist in the folder

---

## 3. Open Chrome Extensions Page

1. Open Google Chrome
2. In the address bar, go to: chrome://extensions/
3. Turn on **Developer mode** using the toggle in the top right corner

---

## 4. Load the Extension

1. Click the **Load unpacked** button
2. In the file picker, select the extracted repository folder (the one containing `manifest.json`)
3. Click **Select Folder**

---

## 5. Confirm It Loaded

- The extension should now appear in the extensions list
- If the extension provides a UI:
  - Click the puzzle icon in Chrome
	- You will need to give it permissions for every FOLIO site you want to run it on
  - Pin the extension if desired
  - Open and test its functionality

---

## 6. Troubleshooting

If the extension does not load or shows errors:

1. Go to chrome://extensions/
2. Find the extension and click **Errors**

Common issues:
- Missing files referenced in `manifest.json`
- Incorrect file paths
- Unsupported manifest version
- Missing or incorrect permissions

---

## 7. Reload After Changes

If you edit any files:

1. Return to chrome://extensions/
2. Click **Reload** on the extension

---

## 8. Debugging

- For background scripts (Manifest v3):
  - Click **Service Worker** on the extension card to open DevTools

- For content scripts:
  - Open the webpage where the script runs
  - Right-click → Inspect
  - Check the Console tab for logs or errors

---

## Summary

Google Chrome treats the extracted folder as a complete extension:
- `manifest.json` → configuration
- JavaScript files → behavior
- HTML/CSS → user interface

---
