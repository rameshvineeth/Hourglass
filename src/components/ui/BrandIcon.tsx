import React from 'react';

interface BrandIconProps {
  appName: string;
  windowTitle?: string;
  category?: string;
  className?: string;
  appIcon?: string;
}

export const BrandIcon: React.FC<BrandIconProps> = ({
  appName,
  windowTitle = '',
  className = 'w-4 h-4',
  appIcon,
}) => {
  // If native OS extracted icon is provided, render it directly
  if (appIcon && appIcon.startsWith('data:image')) {
    return (
      <img
        src={appIcon}
        alt={appName}
        className={`object-contain rounded-xs shrink-0 select-none ${className}`}
        loading="eager"
      />
    );
  }

  const lowerApp = appName.toLowerCase();
  const lowerTitle = windowTitle.toLowerCase();

  // 1. ChatGPT / OpenAI
  if (lowerTitle.includes('chatgpt') || lowerTitle.includes('openai') || lowerApp.includes('chatgpt')) {
    return (
      <div className={`flex items-center justify-center rounded bg-[#10a37f] text-white p-0.5 shrink-0 ${className}`}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 8.783a4.485 4.485 0 0 1 2.366-1.973v5.684a.776.776 0 0 0 .388.676l5.83 3.366-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 8.783zm15.825 3.104-5.83-3.366 2.02-1.168a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667l-.008-.017zm2.01-4.148-.142-.086-4.778-2.758a.776.776 0 0 0-.785 0L8.63 8.264V5.932a.08.08 0 0 1 .033-.062l4.84-2.79a4.5 4.5 0 0 1 6.662 4.655zM12 10.222 15.08 12 12 13.778 8.92 12 12 10.222z"/>
        </svg>
      </div>
    );
  }

  // 2. Google / Google Search
  if (lowerTitle.includes('google search') || lowerTitle.includes('google.com') || lowerApp.includes('google')) {
    return (
      <div className={`flex items-center justify-center shrink-0 ${className}`}>
        <svg viewBox="0 0 24 24" className="w-full h-full">
          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
          <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
        </svg>
      </div>
    );
  }

  // 3. GitHub
  if (lowerTitle.includes('github.com') || lowerTitle.includes('github') || lowerApp.includes('github')) {
    return (
      <div className={`flex items-center justify-center rounded bg-slate-900 text-white p-0.5 shrink-0 ${className}`}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
          <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
        </svg>
      </div>
    );
  }

  // 4. Antigravity (Official Chevron / A Logo from user's screenshot)
  if (lowerTitle.includes('hourglass') || lowerTitle.includes('antigravity') || lowerApp.includes('antigravity')) {
    return (
      <div className={`flex items-center justify-center rounded-md bg-gradient-to-br from-sky-500 to-blue-600 text-white p-0.5 shadow-sm shrink-0 ${className}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
          <path d="M12 3L2 20h20L12 3z" fill="white" fillOpacity="0.2"/>
          <path d="M12 4L4 18h16L12 4z" stroke="white" />
          <path d="M7 14h10" stroke="white" strokeWidth="2" />
        </svg>
      </div>
    );
  }

  // 5. Microsoft Word
  if (lowerApp.includes('word') || lowerTitle.includes('.docx') || lowerTitle.includes('.doc')) {
    return (
      <div className={`flex items-center justify-center rounded bg-[#185abd] text-white p-0.5 shadow-sm shrink-0 ${className}`}>
        <span className="font-bold text-[10px] leading-none font-sans">W</span>
      </div>
    );
  }

  // 6. Microsoft Excel
  if (lowerApp.includes('excel') || lowerTitle.includes('.xlsx') || lowerTitle.includes('.csv')) {
    return (
      <div className={`flex items-center justify-center rounded bg-[#107c41] text-white p-0.5 shadow-sm shrink-0 ${className}`}>
        <span className="font-bold text-[10px] leading-none font-sans">X</span>
      </div>
    );
  }

  // 7. Microsoft PowerPoint
  if (lowerApp.includes('powerpoint') || lowerTitle.includes('.pptx')) {
    return (
      <div className={`flex items-center justify-center rounded bg-[#c43e1c] text-white p-0.5 shadow-sm shrink-0 ${className}`}>
        <span className="font-bold text-[10px] leading-none font-sans">P</span>
      </div>
    );
  }

  // 8. Visual Studio Code
  if (lowerApp.includes('code') || lowerTitle.includes('visual studio code')) {
    return (
      <div className={`flex items-center justify-center rounded bg-[#007acc] text-white p-0.5 shadow-sm shrink-0 ${className}`}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
          <path d="M17.583 2.125a1.2 1.2 0 0 0-1.282.25L7.49 10.375 3.327 7.218a.9.9 0 0 0-1.233.176l-1.01 1.332a.9.9 0 0 0 .177 1.233l3.666 2.784-3.666 2.784a.9.9 0 0 0-.177 1.233l1.01 1.332a.9.9 0 0 0 1.233.176l4.163-3.157 8.81 7.999a1.2 1.2 0 0 0 1.282.252 1.2 1.2 0 0 0 .783-1.127V3.252a1.2 1.2 0 0 0-.782-1.127zm-2.083 5.408v9.434l-5.613-4.717 5.613-4.717z"/>
        </svg>
      </div>
    );
  }

  // 9. Notepad
  if (lowerApp.includes('notepad') || lowerTitle.includes('.txt')) {
    return (
      <div className={`flex items-center justify-center rounded bg-slate-600 text-white p-0.5 shadow-sm shrink-0 ${className}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      </div>
    );
  }

  // 10. File Explorer
  if (lowerApp.includes('explorer') || lowerTitle.includes('folder:')) {
    return (
      <div className={`flex items-center justify-center rounded bg-amber-500 text-white p-0.5 shadow-sm shrink-0 ${className}`}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
          <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>
        </svg>
      </div>
    );
  }

  // 11. Slack
  if (lowerApp.includes('slack')) {
    return (
      <div className={`flex items-center justify-center rounded bg-[#4a154b] text-white p-0.5 shadow-sm shrink-0 ${className}`}>
        <span className="font-bold text-[10px] leading-none font-sans">#</span>
      </div>
    );
  }

  // 12. Teams
  if (lowerApp.includes('teams')) {
    return (
      <div className={`flex items-center justify-center rounded bg-[#464eb8] text-white p-0.5 shadow-sm shrink-0 ${className}`}>
        <span className="font-bold text-[10px] leading-none font-sans">T</span>
      </div>
    );
  }

  // 13. Zoom
  if (lowerApp.includes('zoom')) {
    return (
      <div className={`flex items-center justify-center rounded bg-[#2d8cff] text-white p-0.5 shadow-sm shrink-0 ${className}`}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
          <path d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5l4 2.5a1 1 0 0 0 1.5-.86v-6.28a1 1 0 0 0-1.5-.86L16 10.5V8a2 2 0 0 0-2-2H4z"/>
        </svg>
      </div>
    );
  }

  // Default web / application fallback
  return (
    <div className={`flex items-center justify-center rounded bg-slate-100 border border-slate-300 text-slate-600 p-0.5 shrink-0 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    </div>
  );
};
