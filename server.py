import os
import sqlite3
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder=".")

DB_FILE = "database.db"

# Detect Render PostgreSQL Database URL
DATABASE_URL = os.environ.get("DATABASE_URL")

# Safe import psycopg2 for local environments where it might not be installed
try:
    import psycopg2
    import psycopg2.extras
    HAS_POSTGRES = True
except ImportError:
    HAS_POSTGRES = False

USING_POSTGRES = (DATABASE_URL is not None) and HAS_POSTGRES

if DATABASE_URL and not HAS_POSTGRES:
    print("[⚠️ WARNING] DATABASE_URL env is set but psycopg2 is not installed. Falling back to local SQLite.")

# --- DATABASE CONNECTION WRAPPERS ---

def get_db():
    if USING_POSTGRES:
        # Connect to PostgreSQL
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    else:
        # Connect to SQLite
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        return conn

def db_execute(conn, query, params=()):
    """
    Unified execution helper.
    Converts %s placeholders to ? dynamically when running on SQLite.
    Returns a cursor supporting fetchone() and fetchall().
    """
    if not USING_POSTGRES:
        # SQLite uses ? instead of %s
        query = query.replace("%s", "?")
        cur = conn.cursor()
        cur.execute(query, params)
        return cur
    else:
        # PostgreSQL uses psycopg2 DictCursor for dict-like row factories
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(query, params)
        return cur

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Create Devices Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS devices (
        mac TEXT PRIMARY KEY,
        name TEXT,
        ip TEXT,
        priority TEXT,
        connected INTEGER,
        trusted INTEGER,
        blocked INTEGER,
        connect_time INTEGER,
        data_used REAL,
        tx_rate REAL,
        rx_rate REAL,
        history_count INTEGER,
        last_active TEXT
    )
    """)
    
    # Create History Table (Handle AUTOINCREMENT differences)
    if USING_POSTGRES:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id SERIAL PRIMARY KEY,
            name TEXT,
            mac TEXT,
            time TEXT,
            duration TEXT,
            data TEXT,
            reason TEXT
        )
        """)
    else:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            mac TEXT,
            time TEXT,
            duration TEXT,
            data TEXT,
            reason TEXT
        )
        """)
    
    # Create Settings Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)
    
    conn.commit()

    # Seed Default Settings if empty
    cursor.execute("SELECT COUNT(*) FROM settings")
    row = cursor.fetchone()
    # Handle dict (Postgres RealDictCursor) vs tuple (SQLite default cursor)
    count = row[0] if isinstance(row, tuple) else row['count']
    
    if count == 0:
        default_settings = [
            ("ssid", "USA-Tech-Hotspot"),
            ("password", "hotspotpassword123"),
            ("band", "5.0"),
            ("active", "1"),
            ("passcode", "1234"),
            ("max_devices", "8"),
            ("data_cap", "5.0"),
            ("auto_block_unknown", "0"),
            ("auto_displace", "1"),
            ("ai_priority_up", "0"),
            ("strict_mac", "0"),
            ("ai_sensitivity", "65")
        ]
        for key, val in default_settings:
            db_execute(conn, "INSERT INTO settings (key, value) VALUES (%s, %s)", (key, val))
        conn.commit()

    # Seed Default Devices if empty
    cursor.execute("SELECT COUNT(*) FROM devices")
    row = cursor.fetchone()
    count = row[0] if isinstance(row, tuple) else row['count']
    
    if count == 0:
        default_devices = [
            ("7c:c3:a1:8f:54:12", "Owner Laptop (MacBook Pro)", "192.168.43.10", "P1", 1, 1, 0, 7200, 1.84, 1.2, 4.5, 15, "Active Now"),
            ("8a:00:27:f2:b4:98", "My iPhone 15 Pro", "192.168.43.15", "P1", 1, 1, 0, 3600, 0.95, 0.5, 1.8, 22, "Active Now"),
            ("3c:15:c2:c0:9a:11", "Mom's iPad Air", "192.168.43.20", "P2", 1, 1, 0, 2700, 0.54, 0.1, 0.8, 8, "Active Now"),
            ("a4:cf:99:d1:22:4b", "Brother's Pixel 7", "192.168.43.32", "P2", 1, 1, 0, 1800, 0.22, 0.2, 1.1, 12, "Active Now"),
            ("cc:20:98:fa:e4:65", "Guest Friend (Android)", "192.168.43.50", "P3", 1, 1, 0, 600, 0.05, 0.8, 2.2, 2, "Active Now"),
            ("82:e2:11:55:cd:99", "Neighbor Windows PC", "192.168.43.99", "P4", 0, 0, 1, 0, 0.01, 0.0, 0.0, 1, "Blocked 1h ago"),
            ("20:a1:00:88:ff:1a", "IoT Smart Bulbs", "192.168.43.81", "P4", 0, 1, 0, 0, 1.10, 0.0, 0.0, 30, "Disconnected 2h ago")
        ]
        for dev in default_devices:
            db_execute(conn, """
            INSERT INTO devices (mac, name, ip, priority, connected, trusted, blocked, connect_time, data_used, tx_rate, rx_rate, history_count, last_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, dev)
        conn.commit()

    # Seed Default History if empty
    cursor.execute("SELECT COUNT(*) FROM history")
    row = cursor.fetchone()
    count = row[0] if isinstance(row, tuple) else row['count']
    
    if count == 0:
        default_history = [
            ("My iPhone 15 Pro", "8a:00:27:f2:b4:98", "2026-08-14 15:30:12", "3h 10m", "1.45 GB", "Manual Disconnect"),
            ("Neighbor Windows PC", "82:e2:11:55:cd:99", "2026-08-14 18:12:45", "2m 14s", "12.4 MB", "Force Blocked by Admin"),
            ("IoT Smart Bulbs", "20:a1:00:88:ff:1a", "2026-08-14 12:00:00", "5h 30m", "1.10 GB", "Inactivity Timeout"),
            ("Sister's Apple Watch", "e2:18:bc:df:99:a2", "2026-08-14 14:15:02", "22m 10s", "5.2 MB", "Out of Range")
        ]
        for hist in default_history:
            db_execute(conn, "INSERT INTO history (name, mac, time, duration, data, reason) VALUES (%s, %s, %s, %s, %s, %s)", hist)
        conn.commit()

    conn.close()

# Safe database initialization
try:
    init_db()
except Exception as ex:
    print(f"[❌ ERROR] Database initialization failed: {ex}")

# --- STATIC FILES ROUTING ---

@app.route("/")
def serve_index():
    return send_from_directory(".", "index.html")

@app.route("/style.css")
def serve_css():
    return send_from_directory(".", "style.css")

@app.route("/app.js")
def serve_js():
    return send_from_directory(".", "app.js")

# --- API ENDPOINTS ---

@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json() or {}
    passcode = data.get("passcode")
    
    conn = get_db()
    val = db_execute(conn, "SELECT value FROM settings WHERE key='passcode'").fetchone()
    conn.close()
    
    if val and passcode == val["value"]:
        return jsonify({"status": "success", "message": "Unlocked"})
    return jsonify({"status": "error", "message": "Invalid passcode"}), 401

@app.route("/api/devices", methods=["GET"])
def get_devices():
    conn = get_db()
    rows = db_execute(conn, "SELECT * FROM devices").fetchall()
    conn.close()
    
    devices = [dict(row) for row in rows]
    return jsonify(devices)

@app.route("/api/devices/edit", methods=["POST"])
def edit_device():
    data = request.get_json() or {}
    mac = data.get("mac")
    name = data.get("name")
    priority = data.get("priority")
    
    if not mac:
        return jsonify({"status": "error", "message": "MAC required"}), 400
        
    conn = get_db()
    db_execute(conn, "UPDATE devices SET name=%s, priority=%s WHERE mac=%s", (name, priority, mac))
    conn.commit()
    conn.close()
    
    return jsonify({"status": "success"})

@app.route("/api/devices/block", methods=["POST"])
def block_device():
    data = request.get_json() or {}
    mac = data.get("mac")
    block_status = data.get("blocked") # True or False
    
    if not mac:
        return jsonify({"status": "error", "message": "MAC required"}), 400
        
    conn = get_db()
    db_block_val = 1 if block_status else 0
    
    # If blocking, force connected offline
    if db_block_val == 1:
        row = db_execute(conn, "SELECT * FROM devices WHERE mac=%s", (mac,)).fetchone()
        if row and row["connected"] == 1:
            # Add to history
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            duration_str = f"{row['connect_time'] // 60}m"
            db_execute(conn, """
            INSERT INTO history (name, mac, time, duration, data, reason)
            VALUES (%s, %s, %s, %s, %s, %s)
            """, (row["name"], row["mac"], now_str, duration_str, f"{row['data_used']:.2f} GB", "Force Blocked by Admin"))
        
        db_execute(conn, "UPDATE devices SET blocked=%s, connected=0, tx_rate=0.0, rx_rate=0.0, last_active='Blocked just now' WHERE mac=%s", (db_block_val, mac))
    else:
        db_execute(conn, "UPDATE devices SET blocked=%s, trusted=1 WHERE mac=%s", (db_block_val, mac))
        
    conn.commit()
    conn.close()
    
    return jsonify({"status": "success"})

@app.route("/api/settings", methods=["GET", "POST"])
def get_or_post_settings():
    conn = get_db()
    if request.method == "POST":
        data = request.get_json() or {}
        for key, val in data.items():
            # Compatible Upsert for both SQLite and PostgreSQL (using Select check)
            row = db_execute(conn, "SELECT 1 FROM settings WHERE key=%s", (key,)).fetchone()
            if row:
                db_execute(conn, "UPDATE settings SET value=%s WHERE key=%s", (str(val), key))
            else:
                db_execute(conn, "INSERT INTO settings (key, value) VALUES (%s, %s)", (key, str(val)))
        conn.commit()
        conn.close()
        return jsonify({"status": "success"})
    else:
        rows = db_execute(conn, "SELECT * FROM settings").fetchall()
        conn.close()
        settings = {row["key"]: row["value"] for row in rows}
        return jsonify(settings)

@app.route("/api/history", methods=["GET", "POST"])
def get_or_clear_history():
    conn = get_db()
    if request.method == "POST":
        db_execute(conn, "DELETE FROM history")
        conn.commit()
        conn.close()
        return jsonify({"status": "success"})
    else:
        rows = db_execute(conn, "SELECT * FROM history ORDER BY id DESC").fetchall()
        conn.close()
        history = [dict(row) for row in rows]
        return jsonify(history)

# --- ANDROID SYNC PORT - INTEGRATION BRIDGE ---
@app.route("/api/android/sync", methods=["POST"])
def android_sync():
    data = request.get_json() or {}
    sync_clients = data.get("client_macs", [])
    
    conn = get_db()
    
    # Load limits
    max_dev_row = db_execute(conn, "SELECT value FROM settings WHERE key='max_devices'").fetchone()
    max_devices = int(max_dev_row["value"]) if max_dev_row else 8
    
    auto_displace_row = db_execute(conn, "SELECT value FROM settings WHERE key='auto_displace'").fetchone()
    auto_displace = int(auto_displace_row["value"]) == 1 if auto_displace_row else True

    auto_block_row = db_execute(conn, "SELECT value FROM settings WHERE key='auto_block_unknown'").fetchone()
    auto_block_unknown = int(auto_block_row["value"]) == 1 if auto_block_row else False

    strict_mac_row = db_execute(conn, "SELECT value FROM settings WHERE key='strict_mac'").fetchone()
    strict_mac = int(strict_mac_row["value"]) == 1 if strict_mac_row else False

    # Get blocked list
    blocked_rows = db_execute(conn, "SELECT mac FROM devices WHERE blocked=1").fetchall()
    blocked_macs = [row["mac"] for row in blocked_rows]

    # Retrieve all current active devices in DB
    db_active_rows = db_execute(conn, "SELECT * FROM devices WHERE connected=1").fetchall()
    db_active_macs = {row["mac"]: dict(row) for row in db_active_rows}

    incoming_macs = []
    sync_blocked_list = []

    for client in sync_clients:
        mac = client.get("mac").strip().lower()
        ip = client.get("ip")
        rx = float(client.get("rx_rate", 0.0))
        tx = float(client.get("tx_rate", 0.0))
        
        # 1. Blocked list check
        if mac in blocked_macs:
            sync_blocked_list.append(mac)
            continue

        # 2. Strict MAC verification
        if strict_mac:
            second_char = mac.replace(":", "")[1] if len(mac.replace(":", "")) > 1 else ""
            if second_char in ['2', '6', 'a', 'e']:
                sync_blocked_list.append(mac)
                continue

        incoming_macs.append(mac)

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Check if already connected in DB
        if mac in db_active_macs:
            # Increment connect time & usage (simulated update)
            db_row = db_active_macs[mac]
            new_time = db_row["connect_time"] + 5 # Synced every 5 seconds
            usage_inc = ((rx + tx) / 8000.0) * 5.0
            new_usage = db_row["data_used"] + usage_inc
            
            db_execute(conn, """
            UPDATE devices SET ip=%s, connect_time=%s, data_used=%s, tx_rate=%s, rx_rate=%s, last_active='Active Now'
            WHERE mac=%s
            """, (ip, new_time, new_usage, tx, rx, mac))
        else:
            # Newly Connected Device (SQLite & Postgres compatible upsert check)
            row = db_execute(conn, "SELECT * FROM devices WHERE mac=%s", (mac,)).fetchone()
            is_trusted = row["trusted"] if row else 0
            
            if auto_block_unknown and not is_trusted:
                if row:
                    db_execute(conn, """
                    UPDATE devices SET ip=%s, connected=0, blocked=1, tx_rate=0.0, rx_rate=0.0, last_active='Auto-Blocked immediately'
                    WHERE mac=%s
                    """, (ip, mac))
                else:
                    db_execute(conn, """
                    INSERT INTO devices (mac, name, ip, priority, connected, trusted, blocked, connect_time, data_used, tx_rate, rx_rate, history_count, last_active)
                    VALUES (%s, %s, %s, 'P4', 0, 0, 1, 0, 0.0, 0.0, 0.0, 1, 'Auto-Blocked immediately')
                    """, (mac, f"Auto-Blocked Node ({mac[:8]})", ip))
                
                db_execute(conn, """
                INSERT INTO history (name, mac, time, duration, data, reason)
                VALUES (%s, %s, %s, '0s', '0 MB', 'Auto-Block Unknown Rule')
                """, (f"Auto-Blocked Node ({mac[:8]})", mac, now_str))
                
                sync_blocked_list.append(mac)
                continue

            # Limit Cap Displacement Evaluation
            current_active_count = len(incoming_macs)
            if current_active_count > max_devices:
                if auto_displace:
                    # Find lowest priority device currently in active database
                    active_list = list(db_active_macs.values())
                    p_weight = {"P4": 4, "P3": 3, "P2": 2, "P1": 1}
                    active_list.sort(key=lambda x: p_weight.get(x["priority"], 4), reverse=True)
                    
                    lowest_active = active_list[0]
                    new_priority = row["priority"] if row else "P4"
                    if p_weight.get(new_priority, 4) < p_weight.get(lowest_active["priority"], 4):
                        # Displace/Kick lowest priority
                        kick_mac = lowest_active["mac"]
                        db_execute(conn, "UPDATE devices SET connected=0, tx_rate=0.0, rx_rate=0.0, last_active=%s WHERE mac=%s", (f"Displaced at {now_str}", kick_mac))
                        db_execute(conn, """
                        INSERT INTO history (name, mac, time, duration, data, reason)
                        VALUES (%s, %s, %s, %s, %s, 'Priority Displaced')
                        """, (lowest_active["name"], kick_mac, now_str, f"{lowest_active['connect_time']//60}m", f"{lowest_active['data_used']:.2f} GB"))
                        
                        sync_blocked_list.append(kick_mac)
                    else:
                        # Reject new device
                        sync_blocked_list.append(mac)
                        continue
                else:
                    sync_blocked_list.append(mac)
                    continue

            # Complete new device setup
            if row:
                db_execute(conn, """
                UPDATE devices SET ip=%s, connected=1, connect_time=0, tx_rate=%s, rx_rate=%s, history_count=history_count+1, last_active='Active Now'
                WHERE mac=%s
                """, (ip, tx, rx, mac))
            else:
                db_execute(conn, """
                INSERT INTO devices (mac, name, ip, priority, connected, trusted, blocked, connect_time, data_used, tx_rate, rx_rate, history_count, last_active)
                VALUES (%s, %s, %s, 'P4', 1, 0, 0, 0, 0.0, %s, %s, 1, 'Active Now')
                """, (mac, f"New Android Node ({mac[-5:]})", ip, tx, rx))

    # 3. Process Disconnected Devices
    for active_mac, active_dev in db_active_macs.items():
        if active_mac not in incoming_macs:
            db_execute(conn, "UPDATE devices SET connected=0, tx_rate=0.0, rx_rate=0.0, last_active=%s WHERE mac=%s", (f"Offline since {datetime.now().strftime('%H:%M')}", active_mac))
            
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            duration_str = f"{active_dev['connect_time'] // 60}m"
            db_execute(conn, """
            INSERT INTO history (name, mac, time, duration, data, reason)
            VALUES (%s, %s, %s, %s, %s, 'Disconnected')
            """, (active_dev["name"], active_mac, now_str, duration_str, f"{active_dev['data_used']:.2f} GB"))

    conn.commit()
    conn.close()

    return jsonify({
        "status": "success",
        "blocked_macs": sync_blocked_list,
        "max_devices": max_devices
    })

if __name__ == "__main__":
    print("-------------------------------------------------------")
    print("   Starting Smart Hotspot Manager Backend Server       ")
    print("   Access Dashboard local link: http://127.0.0.1:5000 ")
    print("-------------------------------------------------------")
    app.run(host="0.0.0.0", port=5000, debug=True)
