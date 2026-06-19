#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 Preparing FlowLink for Vercel deployment...');

// Copy web app files to root for Vercel
const webAppPath = path.join(__dirname, '../apps/web');
const rootPath = path.join(__dirname, '../');

// Files to copy from apps/web to root
const filesToCopy = [
  'app',
  'components',
  'lib',
  'hooks',
  'public',
  'package.json',
  'next.config.js',
  'tailwind.config.js',
  'postcss.config.js',
  'tsconfig.json',
  '.env.local'
];

// Copy each file/directory
filesToCopy.forEach(file => {
  const srcPath = path.join(webAppPath, file);
  const destPath = path.join(rootPath, file);
  
  if (fs.existsSync(srcPath)) {
    if (fs.statSync(srcPath).isDirectory()) {
      // Copy directory recursively
      copyDir(srcPath, destPath);
      console.log(`✅ Copied directory: ${file}`);
    } else {
      // Copy file
      fs.copyFileSync(srcPath, destPath);
      console.log(`✅ Copied file: ${file}`);
    }
  } else {
    console.log(`⚠️  File not found: ${file}`);
  }
});

// Copy node_modules from apps/web
const nodeModulesSrc = path.join(webAppPath, 'node_modules');
const nodeModulesDest = path.join(rootPath, 'node_modules');

if (fs.existsSync(nodeModulesSrc)) {
  console.log('📦 Copying node_modules...');
  copyDir(nodeModulesSrc, nodeModulesDest);
  console.log('✅ Copied node_modules');
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('🎉 FlowLink prepared for Vercel deployment!');
console.log('📝 Next.js app files copied to root directory');
console.log('🌐 Ready for deployment!');
