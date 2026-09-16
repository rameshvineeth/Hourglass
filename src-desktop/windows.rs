use std::collections::HashMap;
use std::path::Path;

use std::sync::{Mutex, OnceLock};

// ============================================================================
// Win32 Foreground Window, Shell & Version Info APIs
// ============================================================================

#[repr(C)]
struct ShFileInfoW {
    h_icon: isize,
    i_icon: i32,
    dw_attributes: u32,
    sz_display_name: [u16; 260],
    sz_type_name: [u16; 80],
}

#[repr(C)]
struct IconInfo {
    f_icon: i32,
    x_hotspot: u32,
    y_hotspot: u32,
    hbm_mask: isize,
    hbm_color: isize,
}

#[repr(C)]
struct BitmapInfoHeader {
    bi_size: u32,
    bi_width: i32,
    bi_height: i32,
    bi_planes: u16,
    bi_bit_count: u16,
    bi_compression: u32,
    bi_size_image: u32,
    bi_x_pels_per_meter: i32,
    bi_y_pels_per_meter: i32,
    bi_clr_used: u32,
    bi_clr_important: u32,
}

#[link(name = "user32")]
extern "system" {
    fn GetForegroundWindow() -> isize;
    fn GetWindowTextW(hWnd: isize, lpString: *mut u16, nMaxCount: i32) -> i32;
    fn GetWindowThreadProcessId(hWnd: isize, lpdwProcessId: *mut u32) -> u32;
    fn GetWindowDisplayAffinity(hWnd: isize, pdwAffinity: *mut u32) -> i32;
    fn GetIconInfo(hIcon: isize, piconinfo: *mut IconInfo) -> i32;
    fn DestroyIcon(hIcon: isize) -> i32;
    fn GetDC(hWnd: isize) -> isize;
    fn ReleaseDC(hWnd: isize, hDC: isize) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> isize;
    fn QueryFullProcessImageNameW(
        hProcess: isize,
        dwFlags: u32,
        lpExeName: *mut u16,
        lpdwSize: *mut u32,
    ) -> i32;
    fn CloseHandle(hObject: isize) -> i32;
}

#[link(name = "shell32")]
extern "system" {
    fn SHGetFileInfoW(
        pszPath: *const u16,
        dwFileAttributes: u32,
        psfi: *mut ShFileInfoW,
        cbFileInfo: u32,
        uFlags: u32,
    ) -> usize;
}

#[link(name = "version")]
extern "system" {
    fn GetFileVersionInfoSizeW(lptstrFilename: *const u16, lpdwHandle: *mut u32) -> u32;
    fn GetFileVersionInfoW(
        lptstrFilename: *const u16,
        dwHandle: u32,
        dwLen: u32,
        lpData: *mut u8,
    ) -> i32;
    fn VerQueryValueW(
        pBlock: *const u8,
        lpSubBlock: *const u16,
        lplpBuffer: *mut *const u16,
        puLen: *mut u32,
    ) -> i32;
}

#[link(name = "gdi32")]
extern "system" {
    fn DeleteObject(ho: isize) -> i32;
    fn GetDIBits(
        hdc: isize,
        hbm: isize,
        start: u32,
        cLines: u32,
        lpvBits: *mut u8,
        lpbmi: *mut BitmapInfoHeader,
        usage: u32,
    ) -> i32;
}

// Global In-Memory Icon Cache: exe_path -> Base64 Data URI
static ICON_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

// PID of child browser window spawned for Hourglass desktop UI

fn get_icon_cache() -> &'static Mutex<HashMap<String, String>> {
    ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_cached_icon(exe_path: &str) -> Option<String> {
    let cache = get_icon_cache().lock().ok()?;
    cache.get(exe_path).cloned()
}

fn set_cached_icon(exe_path: String, icon_b64: String) {
    if let Ok(mut cache) = get_icon_cache().lock() {
        cache.insert(exe_path, icon_b64);
    }
}

// Track last legitimate window to maintain work continuity when private/stealth overlay is active
static LAST_LEGITIMATE_WINDOW: OnceLock<Mutex<Option<crate::capture::Window>>> = OnceLock::new();

fn get_last_legitimate_window() -> &'static Mutex<Option<crate::capture::Window>> {
    LAST_LEGITIMATE_WINDOW.get_or_init(|| Mutex::new(None))
}

fn set_last_legitimate_window(window: crate::capture::Window) {
    if let Ok(mut lock) = get_last_legitimate_window().lock() {
        *lock = Some(window);
    }
}

// ----------------------------------------------------------------------------
// Base64 Encoding
// ----------------------------------------------------------------------------

const BASE64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn encode_base64(data: &[u8]) -> String {
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i];
        let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] } else { 0 };

        result.push(BASE64_CHARS[(b0 >> 2) as usize] as char);
        result.push(BASE64_CHARS[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);

        if i + 1 < data.len() {
            result.push(BASE64_CHARS[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            result.push('=');
        }

        if i + 2 < data.len() {
            result.push(BASE64_CHARS[(b2 & 0x3f) as usize] as char);
        } else {
            result.push('=');
        }

        i += 3;
    }
    result
}

// ----------------------------------------------------------------------------
// Extract Native Application Icon via SHGetFileInfoW
// ----------------------------------------------------------------------------

fn extract_native_app_icon_base64(exe_path: &str) -> Option<String> {
    if let Some(cached) = get_cached_icon(exe_path) {
        return Some(cached);
    }

    if !Path::new(exe_path).exists() {
        return None;
    }

    let mut path_utf16: Vec<u16> = exe_path.encode_utf16().collect();
    path_utf16.push(0);

    unsafe {
        let mut sh_info = std::mem::zeroed::<ShFileInfoW>();
        // SHGFI_ICON (0x100) | SHGFI_LARGEICON (0x0)
        let res = SHGetFileInfoW(
            path_utf16.as_ptr(),
            0,
            &mut sh_info,
            std::mem::size_of::<ShFileInfoW>() as u32,
            0x00000100,
        );

        if res == 0 || sh_info.h_icon == 0 {
            return None;
        }

        let h_icon = sh_info.h_icon;
        let mut icon_info = std::mem::zeroed::<IconInfo>();
        if GetIconInfo(h_icon, &mut icon_info) == 0 {
            DestroyIcon(h_icon);
            return None;
        }

        let hbm_color = icon_info.hbm_color;
        let hbm_mask = icon_info.hbm_mask;

        if hbm_color == 0 {
            if hbm_mask != 0 {
                DeleteObject(hbm_mask);
            }
            DestroyIcon(h_icon);
            return None;
        }

        let hdc = GetDC(0);
        let width: i32 = 32;
        let height: i32 = 32;

        let mut bi = BitmapInfoHeader {
            bi_size: std::mem::size_of::<BitmapInfoHeader>() as u32,
            bi_width: width,
            bi_height: height, // standard bottom-up
            bi_planes: 1,
            bi_bit_count: 32,
            bi_compression: 0, // BI_RGB
            bi_size_image: (width * height * 4) as u32,
            bi_x_pels_per_meter: 0,
            bi_y_pels_per_meter: 0,
            bi_clr_used: 0,
            bi_clr_important: 0,
        };

        let mut pixel_buf = vec![0u8; (width * height * 4) as usize];
        let lines = GetDIBits(
            hdc,
            hbm_color,
            0,
            height as u32,
            pixel_buf.as_mut_ptr(),
            &mut bi,
            0,
        );

        ReleaseDC(0, hdc);
        DeleteObject(hbm_color);
        if hbm_mask != 0 {
            DeleteObject(hbm_mask);
        }
        DestroyIcon(h_icon);

        if lines <= 0 {
            return None;
        }

        // Check alpha channel; if all alpha is 0, make opaque
        let mut has_alpha = false;
        for i in (3..pixel_buf.len()).step_by(4) {
            if pixel_buf[i] > 0 {
                has_alpha = true;
                break;
            }
        }
        if !has_alpha {
            for i in (3..pixel_buf.len()).step_by(4) {
                pixel_buf[i] = 255;
            }
        }

        // Wrap as a valid 32-bit BMP file in memory
        let file_header_size: u32 = 14;
        let info_header_size: u32 = 40;
        let image_size = pixel_buf.len() as u32;
        let file_size = file_header_size + info_header_size + image_size;
        let data_offset = file_header_size + info_header_size;

        let mut bmp_data = Vec::with_capacity(file_size as usize);
        // BMP Header
        bmp_data.extend_from_slice(b"BM");
        bmp_data.extend_from_slice(&file_size.to_le_bytes());
        bmp_data.extend_from_slice(&[0u8; 4]); // reserved
        bmp_data.extend_from_slice(&data_offset.to_le_bytes());

        // DIB Header
        bmp_data.extend_from_slice(&info_header_size.to_le_bytes());
        bmp_data.extend_from_slice(&width.to_le_bytes());
        bmp_data.extend_from_slice(&height.to_le_bytes()); // standard bottom-up
        bmp_data.extend_from_slice(&1u16.to_le_bytes()); // planes
        bmp_data.extend_from_slice(&32u16.to_le_bytes()); // bit count
        bmp_data.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
        bmp_data.extend_from_slice(&image_size.to_le_bytes());
        bmp_data.extend_from_slice(&0u32.to_le_bytes()); // X ppm
        bmp_data.extend_from_slice(&0u32.to_le_bytes()); // Y ppm
        bmp_data.extend_from_slice(&0u32.to_le_bytes()); // clr used
        bmp_data.extend_from_slice(&0u32.to_le_bytes()); // clr important

        // Pixels (already in BGRA top-down)
        bmp_data.extend_from_slice(&pixel_buf);

        let data_uri = format!("data:image/bmp;base64,{}", encode_base64(&bmp_data));
        set_cached_icon(exe_path.to_string(), data_uri.clone());
        Some(data_uri)
    }
}

// ----------------------------------------------------------------------------
// Extract Friendly Application Name via PE Version Information
// ----------------------------------------------------------------------------

fn extract_pe_friendly_app_name(exe_path: &str, exe_name: &str) -> String {
    if !Path::new(exe_path).exists() {
        return format_stem_app_name(exe_name);
    }

    let mut path_utf16: Vec<u16> = exe_path.encode_utf16().collect();
    path_utf16.push(0);

    unsafe {
        let mut handle = 0u32;
        let size = GetFileVersionInfoSizeW(path_utf16.as_ptr(), &mut handle);
        if size > 0 {
            let mut buf = vec![0u8; size as usize];
            if GetFileVersionInfoW(path_utf16.as_ptr(), 0, size, buf.as_mut_ptr()) != 0 {
                // Try common translation codepages:
                // 040904b0 (US English Unicode), 040904E4 (US English Multilingual), 000004b0 (Neutral Unicode)
                let sub_blocks = [
                    r"\StringFileInfo\040904b0\FileDescription",
                    r"\StringFileInfo\040904b0\ProductName",
                    r"\StringFileInfo\040904E4\FileDescription",
                    r"\StringFileInfo\040904E4\ProductName",
                    r"\StringFileInfo\000004b0\FileDescription",
                    r"\StringFileInfo\000004b0\ProductName",
                ];

                for sub in &sub_blocks {
                    let mut sub_utf16: Vec<u16> = sub.encode_utf16().collect();
                    sub_utf16.push(0);

                    let mut ptr: *const u16 = std::ptr::null();
                    let mut len = 0u32;

                    if VerQueryValueW(buf.as_ptr(), sub_utf16.as_ptr(), &mut ptr, &mut len) != 0
                        && !ptr.is_null()
                        && len > 1
                    {
                        let slice = std::slice::from_raw_parts(ptr, (len - 1) as usize);
                        let name = String::from_utf16_lossy(slice).trim().to_string();
                        if !name.is_empty() && !name.to_lowercase().contains("windows host") {
                            return name;
                        }
                    }
                }
            }
        }
    }

    format_stem_app_name(exe_name)
}

fn format_stem_app_name(exe_name: &str) -> String {
    let stem = exe_name.trim_end_matches(".exe").trim_end_matches(".EXE");
    let lower = stem.to_lowercase();
    match lower.as_str() {
        "winword" => "Microsoft Word".to_string(),
        "excel" => "Microsoft Excel".to_string(),
        "powerpnt" => "Microsoft PowerPoint".to_string(),
        "notepad" => "Notepad".to_string(),
        "chrome" => "Google Chrome".to_string(),
        "msedge" => "Microsoft Edge".to_string(),
        "code" => "Visual Studio Code".to_string(),
        "slack" => "Slack".to_string(),
        "teams" => "Microsoft Teams".to_string(),
        "zoom" => "Zoom".to_string(),
        "explorer" => "File Explorer".to_string(),
        _ => {
            let mut c = stem.chars();
            match c.next() {
                None => stem.to_string(),
                Some(first) => first.to_uppercase().collect::<String>() + c.as_str(),
            }
        }
    }
}

// ----------------------------------------------------------------------------
// Systematic Window Title Normalization & Cleaning
// ----------------------------------------------------------------------------

fn infer_category(app_name: &str, title: &str, exe_name: &str) -> String {
    let lower_app = app_name.to_lowercase();
    let lower_title = title.to_lowercase();
    let lower_exe = exe_name.to_lowercase();

    if lower_app.contains("excel")
        || lower_title.contains(".xlsx")
        || lower_title.contains("sheets")
    {
        "spreadsheet".to_string()
    } else if lower_app.contains("word")
        || lower_title.contains(".docx")
        || lower_title.contains("docs")
        || lower_app.contains("notepad")
    {
        "document".to_string()
    } else if lower_app.contains("powerpoint")
        || lower_title.contains(".pptx")
        || lower_title.contains("slides")
    {
        "presentation".to_string()
    } else if lower_app.contains("teams")
        || lower_app.contains("slack")
        || lower_app.contains("chat")
    {
        "communication".to_string()
    } else if lower_app.contains("zoom") || lower_title.contains("meet") {
        "meeting".to_string()
    } else if lower_app.contains("figma")
        || lower_app.contains("sketch")
        || lower_app.contains("canva")
        || lower_app.contains("photoshop")
        || lower_app.contains("illustrator")
        || lower_app.contains("adobe xd")
    {
        "design".to_string()
    } else if lower_app.contains("notion")
        || lower_app.contains("obsidian")
        || lower_app.contains("onenote")
        || lower_app.contains("evernote")
    {
        "document".to_string()
    } else if lower_app.contains("code")
        || lower_app.contains("antigravity")
        || lower_app.contains("cursor")
        || lower_app.contains("windsurf")
        || lower_app.contains("zed")
        || lower_exe.contains("code")
        || lower_exe.contains("studio")
    {
        "development".to_string()
    } else if lower_app.contains("postman")
        || lower_app.contains("insomnia")
        || lower_app.contains("dbeaver")
        || lower_app.contains("tableplus")
        || lower_app.contains("terminal")
        || lower_app.contains("powershell")
        || lower_app.contains("command prompt")
        || lower_exe.contains("wt.exe")
        || lower_exe.contains("windowsterminal")
        || lower_exe.contains("cmd.exe")
    {
        "development".to_string()
    } else if lower_app.contains("chrome")
        || lower_app.contains("edge")
        || lower_app.contains("firefox")
        || lower_app.contains("browser")
        || lower_app.contains("brave")
        || lower_app.contains("safari")
        || lower_app.contains("opera")
        || lower_app.contains("arc")
    {
        "browser".to_string()
    } else if lower_app.contains("explorer") || lower_app.contains("finder") {
        "file_manager".to_string()
    } else {
        "other".to_string()
    }
}

/// Queries the active foreground window, extracts native taskbar icon, PE friendly app name, and normalized title.
pub fn query_os_active_window() -> Option<crate::capture::Window> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == 0 {
            return None;
        }

        // Screen-capture privacy & stealth window guard:
        // Respect native Windows OS capture exclusion (WDA_EXCLUDEFROMCAPTURE = 0x11, WDA_MONITOR = 0x01).
        // If an active foreground window has requested exclusion from screen recording / screen sharing,
        // Hourglass honors that privacy flag and suppresses capture of this window,
        // maintaining continuity with the underlying legitimate work activity.
        let mut affinity = 0u32;
        if GetWindowDisplayAffinity(hwnd, &mut affinity) != 0 && affinity != 0 {
            if let Ok(guard) = get_last_legitimate_window().lock() {
                if let Some(prev) = guard.as_ref() {
                    return Some(prev.clone());
                }
            }
            return None;
        }

        // 1. Get raw window title
        let mut title_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 512);
        if len <= 0 {
            return None;
        }
        let raw_title = String::from_utf16_lossy(&title_buf[..len as usize])
            .trim()
            .to_string();
        if raw_title.is_empty() {
            return None;
        }

        // 2. Get process executable full path and file name
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);

        let mut exe_name = String::from("unknown.exe");
        let mut full_exe_path = String::new();

        let hproc = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, 0, pid);
        if hproc != 0 {
            let mut exe_buf = [0u16; 1024];
            let mut size: u32 = 1024;
            if QueryFullProcessImageNameW(hproc, 0, exe_buf.as_mut_ptr(), &mut size) != 0 {
                full_exe_path = String::from_utf16_lossy(&exe_buf[..size as usize]);
                if let Some(filename) = full_exe_path.split('\\').last() {
                    exe_name = filename.to_string();
                }
            }
            CloseHandle(hproc);
        }

        let lower_title = raw_title.to_lowercase();
        let lower_exe = exe_name.to_lowercase();

        // 1. Filter out self-tracking (Hourglass itself):
        // (a) Current process PID or child app window PID
        let current_pid = std::process::id();

        if pid == current_pid {
            return None;
        }

        // (b) Self titles: Hourglass app window, console runner, or local dev/prod server URLs
        if lower_title.ends_with("hourglass.exe")
            || lower_title.starts_with("hourglass")
            || (lower_title.contains("hourglass")
                && (lower_exe.contains("chrome")
                    || lower_exe.contains("edge")
                    || lower_exe.contains("hourglass")))
        {
            return None;
        }

        // (c) Filter system shell chrome, Start menu, Search, and lock screen processes
        if lower_title == "task switching"
            || lower_title == "taskbar"
            || lower_title == "program manager"
            || lower_title == "unlockingwindow"
            || lower_title == "start"
            || lower_title == "search"
            || lower_title == "windows search"
            || lower_title == "cortana"
            || lower_title == "action center"
            || lower_title == "quick settings"
            || lower_title == "notification center"
            || lower_title.contains("we like this picture")
            || lower_title.contains("like what you see")
            || raw_title.trim().is_empty()
        {
            return None;
        }

        // (d) Filter OS shell host processes — never user activity
        if lower_exe.contains("lockapp")
            || lower_exe.contains("logonui")
            || lower_exe.contains("shellexperiencehost")
            || lower_exe.contains("startmenuexperiencehost")
            || lower_exe.contains("searchhost")
            || lower_exe.contains("searchapp")
            || lower_exe.contains("gamebar")
            || lower_title.contains("lockapp")
            || lower_title.contains("start experience host")
        {
            return None;
        }

        // 3. Extract OS friendly app name from PE metadata
        let app_name = extract_pe_friendly_app_name(&full_exe_path, &exe_name);
        let lower_app = app_name.to_lowercase();
        if lower_app.contains("start experience")
            || lower_app.contains("shellexperience")
            || (lower_app.contains("windows")
                && lower_app.contains("operating system")
                && (lower_title.is_empty() || lower_title == "search" || lower_title == "start"))
        {
            return None;
        }

        // 4. Extract native OS taskbar icon (Base64 data URI)
        let app_icon = extract_native_app_icon_base64(&full_exe_path);

        // 5. Systematically clean window title
        let clean_title = raw_title.clone();

        // 6. Infer activity category
        let category = infer_category(&app_name, &clean_title, &exe_name);

        let window = crate::capture::Window {
            app: app_name,
            title: clean_title,
            category,
            icon: app_icon,
            executable: full_exe_path,
        };

        set_last_legitimate_window(window.clone());
        Some(window)
    }
}
