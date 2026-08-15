// Smart Hotspot App - Mobile-First Frontend Engine & API Connector

let state = {
    devices: [],
    history: [],
    settings: {},
    activeTab: "dashboard",
    isLocked: true,
    selectedDeviceMac: null
};

// Speeds queue for plotting (20 metrics)
let speedHistory = Array(20).fill(0);
let currentTotalSpeed = 0;
let refreshInterval = null;

// --- SECURE PORTAL LOCKING ---
const authPortal = document.getElementById("auth-portal");
const passcodeField = document.getElementById("passcode-input");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const authErrorMsg = document.getElementById("auth-error-msg");

function checkAuthStatus() {
    const sessionAuth = sessionStorage.getItem("hotspot_auth_token");
    if (sessionAuth === "authenticated") {
        state.isLocked = false;
        authPortal.style.display = "none";
        startPolling();
    } else {
        state.isLocked = true;
        authPortal.style.display = "flex";
        authPortal.style.opacity = 1;
        passcodeField.value = "";
        passcodeField.focus();
    }
}

loginBtn.addEventListener("click", performLogin);
passcodeField.addEventListener("keypress", (e) => {
    if (e.key === "Enter") performLogin();
});

async function performLogin() {
    const passcode = passcodeField.value.trim();
    try {
        const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ passcode })
        });
        const data = await res.json();
        
        if (res.ok && data.status === "success") {
            state.isLocked = false;
            sessionStorage.setItem("hotspot_auth_token", "authenticated");
            authPortal.style.opacity = 0;
            setTimeout(() => {
                authPortal.style.display = "none";
            }, 300);
            authErrorMsg.style.display = "none";
            startPolling();
        } else {
            authErrorMsg.style.display = "block";
            passcodeField.value = "";
            passcodeField.focus();
        }
    } catch (err) {
        console.error("Auth error, falling back to offline mode:", err);
        if (passcode === "1234") {
            state.isLocked = false;
            sessionStorage.setItem("hotspot_auth_token", "authenticated");
            authPortal.style.opacity = 0;
            setTimeout(() => {
                authPortal.style.display = "none";
            }, 300);
            authErrorMsg.style.display = "none";
            
            // Seed local mock data
            state.devices = [
                { name: "Owner Laptop (MacBook Pro)", mac: "7c:c3:a1:8f:54:12", ip: "192.168.43.10", priority: "P1", connected: true, trusted: true, blocked: false, connect_time: 7200, data_used: 1.84, tx_rate: 1.2, rx_rate: 4.5, history_count: 15, last_active: "Active Now" },
                { name: "My iPhone 15 Pro", mac: "8a:00:27:f2:b4:98", ip: "192.168.43.15", priority: "P1", connected: true, trusted: true, blocked: false, connect_time: 3600, data_used: 0.95, tx_rate: 0.5, rx_rate: 1.8, history_count: 22, last_active: "Active Now" },
                { name: "Mom's iPad Air", mac: "3c:15:c2:c0:9a:11", ip: "192.168.43.20", priority: "P2", connected: true, trusted: true, blocked: false, connect_time: 2700, data_used: 0.54, tx_rate: 0.1, rx_rate: 0.8, history_count: 8, last_active: "Active Now" }
            ];
            state.history = [
                { name: "My iPhone 15 Pro", mac: "8a:00:27:f2:b4:98", time: "2026-08-14 15:30:12", duration: "3h 10m", data: "1.45 GB", reason: "Manual Disconnect" }
            ];
            state.settings = { ssid: "Offline-Mock-Hotspot", password: "hotspotpassword123", band: "5.0", active: true, max_devices: 8, data_cap: 5.0 };
            
            renderAll();
            showToast("⚠️ Offline Mode Active", "Running local fallback mode. Start server.py for real connections.", "alert");
        } else {
            authErrorMsg.innerText = "Invalid offline passcode.";
            authErrorMsg.style.display = "block";
            passcodeField.value = "";
            passcodeField.focus();
        }
    }
}

logoutBtn.addEventListener("click", () => {
    state.isLocked = true;
    sessionStorage.removeItem("hotspot_auth_token");
    stopPolling();
    authPortal.style.display = "flex";
    setTimeout(() => {
        authPortal.style.opacity = 1;
    }, 50);
});

// --- API DATA LOADERS ---

function simulateLocalDataOffline() {
    let totalSpeed = 0;
    state.devices.forEach(device => {
        if (device.connected && !device.blocked) {
            device.connect_time += 3;
            const rx = parseFloat((Math.random() * 2).toFixed(2));
            const tx = parseFloat((Math.random() * 0.3).toFixed(2));
            device.rx_rate = rx;
            device.tx_rate = tx;
            totalSpeed += rx + tx;
            device.data_used = parseFloat((device.data_used + ((rx + tx) / 8000.0) * 3.0).toFixed(4));
        }
    });
    currentTotalSpeed = parseFloat(totalSpeed.toFixed(1));
    speedHistory.push(currentTotalSpeed);
    speedHistory.shift();
}

async function fetchAllData() {
    if (state.isLocked) return;
    try {
        // Load Settings
        const settingsRes = await fetch("/api/settings");
        if (!settingsRes.ok) throw new Error("Offline");
        state.settings = await settingsRes.json();

        // Load Devices
        const devicesRes = await fetch("/api/devices");
        state.devices = await devicesRes.json();

        // Load History logs
        const historyRes = await fetch("/api/history");
        state.history = await historyRes.json();

        renderAll();
    } catch (err) {
        console.log("Using local offline simulation fallback.");
        simulateLocalDataOffline();
        renderAll();
    }
}

// --- POLLING ENGINE ---
function startPolling() {
    fetchAllData();
    if (!refreshInterval) {
        refreshInterval = setInterval(fetchAllData, 3000); // Poll every 3 seconds
    }
}

function stopPolling() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

// --- TAB ROUTING ---
const navItems = document.querySelectorAll(".app-bottom-nav .nav-item");
const tabContents = document.querySelectorAll(".tab-content");

navItems.forEach(item => {
    item.addEventListener("click", () => {
        const targetTab = item.getAttribute("data-tab");
        switchTab(targetTab);
    });
});

function switchTab(tabId) {
    state.activeTab = tabId;
    
    // Update bottom nav UI
    navItems.forEach(lnk => {
        if (lnk.getAttribute("data-tab") === tabId) {
            lnk.classList.add("active");
        } else {
            lnk.classList.remove("active");
        }
    });

    // Update active tab visible
    tabContents.forEach(content => {
        if (content.id === tabId) {
            content.classList.add("active");
        } else {
            content.classList.remove("active");
        }
    });

    renderAll();
}

// --- TRUST SCORE ALGORITHM ---
function getTrustScore(device) {
    if (device.blocked) return 10;
    
    let score = 50; // Starting baseline
    
    // Priority weights
    if (device.priority === "P1") score += 40;
    else if (device.priority === "P2") score += 25;
    else if (device.priority === "P3") score += 10;
    
    // Frequency
    const freq = device.history_count || 0;
    score += Math.min(freq * 2, 20);

    // MAC randomized check
    const secondChar = device.mac.charAt(1).toLowerCase();
    const isRandomized = ['2', '6', 'a', 'e'].includes(secondChar);
    if (isRandomized) {
        score -= 25;
    }

    return Math.max(0, Math.min(100, score));
}

function getTrustBadge(score) {
    if (score >= 75) {
        return `<span class="badge badge-trust-high" title="AI Verification: High Trust">High Trust (${score})</span>`;
    } else if (score >= 40) {
        return `<span class="badge badge-trust-med" title="AI Verification: Medium Trust">Medium (${score})</span>`;
    } else {
        return `<span class="badge badge-trust-low" title="AI Verification: Suspicious Connection">Low Trust (${score})</span>`;
    }
}

// --- REAL-TIME CHART UTILITY ---
function updateSpeedChart() {
    const linePath = document.getElementById("chart-line-path");
    const areaPath = document.getElementById("chart-area-path");
    if (!linePath || !areaPath) return;

    // Estimate speed from currently active rates
    let totalSpeed = 0;
    state.devices.forEach(d => {
        if (d.connected && !d.blocked) {
            totalSpeed += (d.rx_rate || 0.0) + (d.tx_rate || 0.0);
        }
    });
    
    currentTotalSpeed = parseFloat(totalSpeed.toFixed(1));
    speedHistory.push(currentTotalSpeed);
    speedHistory.shift();

    const width = 450; 
    const height = 170;
    const startX = 35;
    const endX = 450;
    const pointsCount = speedHistory.length;
    
    let pathString = "";
    const maxVal = 15; // Mbps
    
    for (let i = 0; i < pointsCount; i++) {
        const val = speedHistory[i];
        const x = startX + ((endX - startX) / (pointsCount - 1)) * i;
        const y = height - (Math.min(val, maxVal) / maxVal) * (height - 30);
        
        if (i === 0) {
            pathString += `M ${x} ${y}`;
        } else {
            pathString += ` L ${x} ${y}`;
        }
    }
    
    linePath.setAttribute("d", pathString);
    const areaString = `${pathString} L ${endX} ${height} L ${startX} ${height} Z`;
    areaPath.setAttribute("d", areaString);
}

// --- RENDER DYNAMIC COMPONENT UTILITIES ---

function formatDuration(sec) {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

function renderAll() {
    // 1. Status header updates
    const indicatorBadge = document.getElementById("hotspot-status-badge");
    const statusText = document.getElementById("hotspot-status-text");
    const toggleInput = document.getElementById("hotspot-toggle");
    
    const isHotspotActive = state.settings.active === "1" || state.settings.active === true;
    
    if (isHotspotActive) {
        indicatorBadge.className = "status-indicator active";
        indicatorBadge.innerText = "ACTIVE";
        statusText.innerText = `Broadcasting as ${state.settings.ssid || "USA-Tech-Hotspot"}`;
        toggleInput.checked = true;
    } else {
        indicatorBadge.className = "status-indicator inactive";
        indicatorBadge.innerText = "INACTIVE";
        statusText.innerText = "Hotspot system is offline";
        toggleInput.checked = false;
    }

    // 2. Load metric values
    const activeList = state.devices.filter(d => d.connected && !d.blocked);
    const blockedList = state.devices.filter(d => d.blocked);
    
    const maxDevicesLimit = parseInt(state.settings.max_devices || 8);
    const dataCapGb = parseFloat(state.settings.data_cap || 5.0);
    
    const todayUsage = parseFloat(activeList.reduce((acc, dev) => acc + (dev.data_used || 0), 0).toFixed(2));
    const capPercent = Math.min(100, Math.floor((todayUsage / dataCapGb) * 100));

    // Dashboard metrics
    const elActive = document.getElementById("metric-active-devices");
    if (elActive) elActive.innerText = activeList.length;
    
    const elLimit = document.getElementById("metric-max-limit");
    if (elLimit) elLimit.innerText = maxDevicesLimit;
    
    const elData = document.getElementById("metric-data-used");
    if (elData) elData.innerText = `${todayUsage.toFixed(2)} GB`;
    
    const elSpeed = document.getElementById("metric-speed");
    if (elSpeed) elSpeed.innerText = currentTotalSpeed;
    
    const elPercent = document.getElementById("metric-cap-percent");
    if (elPercent) elPercent.innerText = `${capPercent}%`;
    
    const elProgressBar = document.getElementById("metric-cap-progress-bar");
    if (elProgressBar) elProgressBar.style.width = `${capPercent}%`;

    // Speed chart update
    updateSpeedChart();

    // 3. Tab rendering routers
    if (state.activeTab === "dashboard") {
        renderDashboardList(activeList);
    } else if (state.activeTab === "devices") {
        const activeChip = document.querySelector(".filter-chip.active");
        const filterVal = activeChip ? activeChip.getAttribute("data-filter") : "all";
        renderDevicesDirectory(filterVal);
    } else if (state.activeTab === "rules") {
        renderRulesForms(maxDevicesLimit, dataCapGb);
    } else if (state.activeTab === "history") {
        renderHistoryList(todayUsage);
    } else if (state.activeTab === "settings") {
        renderSettingsForms();
    }
}

// Render Dashboard Clients
function renderDashboardList(activeList) {
    const listEl = document.getElementById("dashboard-active-list");
    if (!listEl) return;

    if (activeList.length === 0) {
        listEl.innerHTML = `
            <div class="device-item" style="justify-content: center; color: var(--text-muted); padding: 1.5rem; text-align: center; font-size: 0.85rem;">
                No devices currently connected to hotspot.
            </div>`;
        return;
    }

    listEl.innerHTML = activeList.map(dev => {
        const trust = getTrustScore(dev);
        const priorityClass = dev.priority.toLowerCase();
        
        return `
        <div class="device-item">
            <div class="device-avatar active">📱</div>
            <div class="device-info">
                <div class="device-name-container">
                    <span class="device-name">${dev.name}</span>
                    <span class="badge badge-${priorityClass}">${dev.priority}</span>
                    ${getTrustBadge(trust)}
                </div>
                <div class="device-ip-mac">IP: ${dev.ip} &bull; MAC: ${dev.mac}</div>
                <div class="device-details-row">
                    <div class="device-detail-stat">⏱️ ${formatDuration(dev.connect_time)}</div>
                    <div class="device-detail-stat">📊 ${dev.data_used.toFixed(2)} GB</div>
                    <div class="device-detail-stat" style="color: var(--primary);">⬆️ ${(dev.tx_rate || 0.0).toFixed(1)}M &bull; ⬇️ ${(dev.rx_rate || 0.0).toFixed(1)}M</div>
                </div>
            </div>
            <div class="device-actions">
                <button class="action-icon-btn" title="Block Device" onclick="quickBlockDevice('${dev.mac}')">🚫</button>
                <button class="action-icon-btn" title="Edit Device" onclick="showDeviceDetails('${dev.mac}')">⚙️</button>
            </div>
        </div>`;
    }).join('');
}

// Render Devices Directory
function renderDevicesDirectory(filter = "all") {
    const listEl = document.getElementById("devices-full-list");
    if (!listEl) return;

    let filtered = [...state.devices];
    if (filter === "active") {
        filtered = filtered.filter(d => d.connected && !d.blocked);
    } else if (filter === "trusted") {
        filtered = filtered.filter(d => d.trusted && !d.blocked);
    } else if (filter === "blocked") {
        filtered = filtered.filter(d => d.blocked);
    }

    // Counters update
    document.getElementById("count-all").innerText = state.devices.length;
    document.getElementById("count-active").innerText = state.devices.filter(d => d.connected && !d.blocked).length;
    document.getElementById("count-trusted").innerText = state.devices.filter(d => d.trusted && !d.blocked).length;
    document.getElementById("count-blocked").innerText = state.devices.filter(d => d.blocked).length;

    if (filtered.length === 0) {
        listEl.innerHTML = `<div class="device-item" style="justify-content: center; color: var(--text-muted); padding: 2rem; font-size: 0.85rem;">
            No devices matched the selected filter.
        </div>`;
        return;
    }

    listEl.innerHTML = filtered.map(dev => {
        const trust = getTrustScore(dev);
        const priorityClass = dev.priority.toLowerCase();
        
        let statusBadge = "";
        let avatarClass = "";
        
        if (dev.blocked) {
            statusBadge = `<span class="badge" style="background-color: var(--accent-red-light); color: var(--accent-red);">Blocked</span>`;
            avatarClass = "blocked";
        } else if (dev.connected) {
            statusBadge = `<span class="badge" style="background-color: var(--accent-green-light); color: var(--accent-green);">Active</span>`;
            avatarClass = "active";
        } else {
            statusBadge = `<span class="badge" style="background-color: var(--border-color); color: var(--text-secondary);">Offline</span>`;
            avatarClass = "";
        }

        return `
        <div class="device-item">
            <div class="device-avatar ${avatarClass}">${dev.blocked ? '🚫' : '💻'}</div>
            <div class="device-info">
                <div class="device-name-container">
                    <span class="device-name">${dev.name}</span>
                    <span class="badge badge-${priorityClass}">${dev.priority}</span>
                    ${statusBadge}
                </div>
                <div class="device-ip-mac">IP: ${dev.ip || "Offline"} &bull; MAC: ${dev.mac}</div>
                <div class="device-details-row">
                    <div class="device-detail-stat">Usage: ${dev.data_used.toFixed(2)} GB</div>
                    ${getTrustBadge(trust)}
                </div>
            </div>
            <div class="device-actions">
                ${dev.blocked ? 
                    `<button class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.3rem 0.6rem;" onclick="unblockDevice('${dev.mac}')">Allow</button>` :
                    `<button class="btn btn-danger" style="font-size: 0.75rem; padding: 0.3rem 0.6rem;" onclick="quickBlockDevice('${dev.mac}')">Block</button>`
                }
                <button class="action-icon-btn" title="Device Details" onclick="showDeviceDetails('${dev.mac}')">⚙️</button>
            </div>
        </div>`;
    }).join('');
}

// Attach filter chip listeners
const filterChips = document.querySelectorAll(".filter-chip");
filterChips.forEach(chip => {
    chip.addEventListener("click", () => {
        filterChips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        renderDevicesDirectory(chip.getAttribute("data-filter"));
    });
});

// Render Rules configurations
function renderRulesForms(maxDev, capGb) {
    const autoBlockChk = document.getElementById("auto-block-unknown-toggle");
    if (autoBlockChk) autoBlockChk.checked = state.settings.auto_block_unknown === "1";

    const displaceChk = document.getElementById("auto-displace-toggle");
    if (displaceChk) displaceChk.checked = state.settings.auto_displace === "1";

    const strictMacChk = document.getElementById("strict-mac-toggle");
    if (strictMacChk) strictMacChk.checked = state.settings.strict_mac === "1";

    const devicesSlider = document.getElementById("limit-max-devices-slider");
    if (devicesSlider) {
        devicesSlider.value = maxDev;
        document.getElementById("limit-max-devices-val").innerText = maxDev;
    }
    
    const capSlider = document.getElementById("limit-data-cap-slider");
    if (capSlider) {
        capSlider.value = capGb;
        document.getElementById("limit-data-cap-val").innerText = `${capGb.toFixed(1)} GB`;
    }
}

// Render History view
function renderHistoryList(todayUsage) {
    const listEl = document.getElementById("history-list-container");
    if (!listEl) return;

    // Total lifetime data label update
    const lifeEl = document.getElementById("analytics-total-lifetime");
    if (lifeEl) {
        lifeEl.innerText = `${parseFloat((124.8 + todayUsage).toFixed(2))} GB`;
    }

    const searchQuery = document.getElementById("history-search").value.trim().toLowerCase();
    let logs = [...state.history];
    
    if (searchQuery !== "") {
        logs = logs.filter(l => 
            l.name.toLowerCase().includes(searchQuery) ||
            l.mac.toLowerCase().includes(searchQuery) ||
            l.reason.toLowerCase().includes(searchQuery)
        );
    }

    if (logs.length === 0) {
        listEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 2rem;">
            No history logs found.
        </div>`;
        return;
    }

    listEl.innerHTML = logs.map(log => {
        const isKick = log.reason.includes("Block") || log.reason.includes("Kicked") || log.reason.includes("Displaced");
        const reasonColor = isKick ? "var(--accent-red)" : "var(--text-secondary)";
        const reasonBg = isKick ? "var(--accent-red-light)" : "var(--bg-secondary)";
        
        return `
        <div class="history-card">
            <div class="history-card-header">
                <span class="history-card-title">${log.name}</span>
                <span class="history-card-time">${log.time}</span>
            </div>
            <div class="history-card-details">
                <span>MAC: <span style="font-family: monospace;">${log.mac}</span></span>
                <span>Duration: <b>${log.duration}</b></span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem;">
                <span style="font-size: 0.75rem; color: var(--text-muted);">Data: ${log.data}</span>
                <span class="badge" style="background-color: ${reasonBg}; color: ${reasonColor}; font-size: 0.65rem;">${log.reason}</span>
            </div>
        </div>`;
    }).join('');
}

// History search input listener
document.getElementById("history-search").addEventListener("input", () => {
    const todayUsage = parseFloat(state.devices.filter(d => d.connected && !d.blocked).reduce((acc, dev) => acc + (dev.data_used || 0), 0).toFixed(2));
    renderHistoryList(todayUsage);
});

// Clear history button click
document.getElementById("clear-history-btn").addEventListener("click", async () => {
    if (confirm("Purge all hotspot connection session logs?")) {
        try {
            const res = await fetch("/api/history", { method: "POST" });
            if (res.ok) {
                showToast("📜 Logs Purged", "Hotspot connection logs cleared.", "success");
                fetchAllData();
            }
        } catch (err) {
            console.error("Error clearing history:", err);
        }
    }
});

// Render Settings Form Inputs
function renderSettingsForms() {
    const ssidField = document.getElementById("settings-ssid");
    if (ssidField) ssidField.value = state.settings.ssid || "";

    const passField = document.getElementById("settings-password");
    if (passField) passField.value = state.settings.password || "";

    const bandSelect = document.getElementById("settings-band");
    if (bandSelect) bandSelect.value = state.settings.band || "5.0";

    const localPasscode = document.getElementById("settings-passcode");
    if (localPasscode) localPasscode.value = state.settings.passcode || "";
}

// --- CORE ACTIONS & REST WRAPPERS ---

// Toggle hotspot status (Broadcasting switch)
document.getElementById("hotspot-toggle").addEventListener("change", async (e) => {
    const activeVal = e.target.checked ? "1" : "0";
    try {
        const res = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: activeVal })
        });
        if (res.ok) {
            showToast(
                activeVal === "1" ? "📶 Hotspot Broadcasted" : "🚫 Hotspot Disabled",
                activeVal === "1" ? "Wi-Fi SSID is active." : "All connections closed.",
                activeVal === "1" ? "success" : "alert"
            );
            fetchAllData();
        }
    } catch (err) {
        console.error("Hotspot toggle failed:", err);
    }
});

// Limits adjustments slider triggers API POST
const maxDevSlider = document.getElementById("limit-max-devices-slider");
maxDevSlider.addEventListener("input", (e) => {
    document.getElementById("limit-max-devices-val").innerText = e.target.value;
});
maxDevSlider.addEventListener("change", async (e) => {
    try {
        await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ max_devices: e.target.value })
        });
        showToast("Threshold Updated", `Max concurrency set to ${e.target.value} devices.`);
    } catch (err) {
        console.error(err);
    }
});

const dataCapSlider = document.getElementById("limit-data-cap-slider");
dataCapSlider.addEventListener("input", (e) => {
    document.getElementById("limit-data-cap-val").innerText = `${parseFloat(e.target.value).toFixed(1)} GB`;
});
dataCapSlider.addEventListener("change", async (e) => {
    try {
        await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data_cap: e.target.value })
        });
        showToast("Data Limit Updated", `Daily limit capped at ${e.target.value} GB.`);
    } catch (err) {
        console.error(err);
    }
});

// Rules toggle switches trigger API POST
async function toggleRuleSetting(key, val) {
    try {
        const res = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [key]: val })
        });
        if (res.ok) {
            showToast("System Rules Saved", "Automatic policies modified.");
        }
    } catch (err) {
        console.error(err);
    }
}

document.getElementById("auto-block-unknown-toggle").addEventListener("change", (e) => {
    toggleRuleSetting("auto_block_unknown", e.target.checked ? "1" : "0");
});
document.getElementById("auto-displace-toggle").addEventListener("change", (e) => {
    toggleRuleSetting("auto_displace", e.target.checked ? "1" : "0");
});
document.getElementById("strict-mac-toggle").addEventListener("change", (e) => {
    toggleRuleSetting("strict_mac", e.target.checked ? "1" : "0");
});

// Settings save buttons
document.getElementById("save-hotspot-settings").addEventListener("click", async () => {
    const ssid = document.getElementById("settings-ssid").value.trim();
    const password = document.getElementById("settings-password").value.trim();
    const band = document.getElementById("settings-band").value;
    
    try {
        const res = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ssid, password, band })
        });
        if (res.ok) {
            showToast("SSID Config Saved", "Wi-Fi broadcast parameters updated.", "success");
            fetchAllData();
        }
    } catch (err) {
        console.error(err);
    }
});

document.getElementById("save-security-settings").addEventListener("click", async () => {
    const passcode = document.getElementById("settings-passcode").value.trim();
    if (passcode.length < 4) {
        alert("Passcode PIN must be at least 4 digits.");
        return;
    }
    try {
        const res = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ passcode })
        });
        if (res.ok) {
            showToast("PIN Updated", "Dashboard access passcode updated successfully.", "success");
            fetchAllData();
        }
    } catch (err) {
        console.error(err);
    }
});

// Core Blacklist Operations
async function quickBlockDevice(mac) {
    try {
        const res = await fetch("/api/devices/block", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mac, blocked: true })
        });
        if (res.ok) {
            showToast("🚫 Node Blacklisted", `Device (${mac.slice(-5)}) blocked.`, "alert");
            fetchAllData();
        }
    } catch (err) {
        console.error(err);
    }
}

async function unblockDevice(mac) {
    try {
        const res = await fetch("/api/devices/block", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mac, blocked: false })
        });
        if (res.ok) {
            showToast("✅ Node Whitelisted", "Connection allowed.", "success");
            fetchAllData();
        }
    } catch (err) {
        console.error(err);
    }
}

// --- EDIT MODAL INTERACTION ---
const deviceModal = document.getElementById("device-modal");
const modalSaveBtn = document.getElementById("modal-save-btn");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const modalCloseIcon = document.getElementById("modal-close-icon");
const modalBlockBtn = document.getElementById("modal-block-btn");

function showDeviceDetails(mac) {
    const device = state.devices.find(d => d.mac === mac);
    if (!device) return;

    state.selectedDeviceMac = mac;

    document.getElementById("modal-device-title").innerText = device.name;
    document.getElementById("modal-input-name").value = device.name;
    document.getElementById("modal-select-priority").value = device.priority;
    
    document.getElementById("modal-detail-ip").innerText = device.ip || "Offline";
    document.getElementById("modal-detail-mac").innerText = device.mac;
    
    const trust = getTrustScore(device);
    document.getElementById("modal-detail-trust").innerText = `${trust} / 100`;
    document.getElementById("modal-detail-rate").innerText = `${device.data_used.toFixed(2)} GB`;

    if (device.blocked) {
        modalBlockBtn.innerText = "Unblock Device";
        modalBlockBtn.className = "btn btn-secondary";
    } else {
        modalBlockBtn.innerText = "Block Device";
        modalBlockBtn.className = "btn btn-danger";
    }

    deviceModal.classList.add("active");
}

function closeDeviceModal() {
    deviceModal.classList.remove("active");
    state.selectedDeviceMac = null;
}

modalCloseIcon.addEventListener("click", closeDeviceModal);
modalCancelBtn.addEventListener("click", closeDeviceModal);
deviceModal.addEventListener("click", (e) => {
    if (e.target === deviceModal) closeDeviceModal();
});

modalSaveBtn.addEventListener("click", async () => {
    if (!state.selectedDeviceMac) return;

    const name = document.getElementById("modal-input-name").value.trim();
    const priority = document.getElementById("modal-select-priority").value;
    
    try {
        const res = await fetch("/api/devices/edit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mac: state.selectedDeviceMac, name, priority })
        });
        if (res.ok) {
            showToast("Profile Updated", "Client configuration applied.", "success");
            closeDeviceModal();
            fetchAllData();
        }
    } catch (err) {
        console.error(err);
    }
});

modalBlockBtn.addEventListener("click", async () => {
    if (!state.selectedDeviceMac) return;
    const device = state.devices.find(d => d.mac === state.selectedDeviceMac);
    if (device) {
        if (device.blocked) {
            await unblockDevice(device.mac);
        } else {
            await quickBlockDevice(device.mac);
        }
        closeDeviceModal();
    }
});

// --- DYNAMIC INTEGRATION SIMULATION: SYNC POST ---
const MOCK_MACS = [
    { name: "Sony SmartTV Bravia", mac: "f4:d8:5d:00:a1:ce", ip: "192.168.43.102" },
    { name: "Unknown ESP32 Board", mac: "24:0a:c4:99:be:8c", ip: "192.168.43.141" },
    { name: "Dad's Galaxy S23", mac: "b0:c2:88:ef:31:0a", ip: "192.168.43.111" },
    { name: "Alexa Smart Speaker", mac: "cc:f4:11:4a:d5:b1", ip: "192.168.43.125" }
];

document.getElementById("simulate-connect-btn").addEventListener("click", async () => {
    const isHotspotActive = state.settings.active === "1" || state.settings.active === true;
    if (!isHotspotActive) {
        showToast("Action Refused", "Active broadcasting required.", "alert");
        return;
    }

    // Assemble mock scanner sync array
    const activeClientsInDb = state.devices.filter(d => d.connected && !d.blocked);
    const clientList = activeClientsInDb.map(d => ({
        mac: d.mac,
        ip: d.ip,
        tx_rate: (Math.random() * 0.5).toFixed(2),
        rx_rate: (Math.random() * 2.5).toFixed(2)
    }));

    // Insert a new mock client connection
    const template = MOCK_MACS[Math.floor(Math.random() * MOCK_MACS.length)];
    clientList.push({
        mac: template.mac,
        ip: template.ip,
        tx_rate: "0.20",
        rx_rate: "1.10"
    });

    try {
        const res = await fetch("/api/android/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_macs: clientList })
        });
        const syncRes = await res.json();
        
        if (res.ok && syncRes.status === "success") {
            showToast(
                "📶 Scanning Sync Completed",
                `Android scan synced ${clientList.length} nodes to backend API.`,
                "success"
            );
            fetchAllData();
        }
    } catch (err) {
        console.error("Sync mock connection error:", err);
    }
});

// --- TOAST WARNINGS ---
function showToast(title, body, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type === 'alert' ? 'alert' : ''}`;
    
    let icon = "🔔";
    if (type === "success") icon = "✅";
    if (type === "alert") icon = "⚠️";

    toast.innerHTML = `
        <button class="toast-close">&times;</button>
        <div class="toast-header">
            <span>${icon}</span>
            <span>${title}</span>
        </div>
        <div class="toast-body">${body}</div>
    `;

    container.appendChild(toast);

    toast.querySelector(".toast-close").addEventListener("click", () => {
        toast.style.transform = "translateY(100%)";
        toast.style.opacity = 0;
        setTimeout(() => toast.remove(), 250);
    });

    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.transform = "translateY(100%)";
            toast.style.opacity = 0;
            setTimeout(() => toast.remove(), 250);
        }
    }, 5000);
}

// Global actions exposed on window scope
window.quickBlockDevice = quickBlockDevice;
window.unblockDevice = unblockDevice;
window.showDeviceDetails = showDeviceDetails;

// Initialize app
checkAuthStatus();
