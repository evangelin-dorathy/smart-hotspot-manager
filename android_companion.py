import os
import re
import sys
import time
import socket
import subprocess
import requests

API_URL = "http://localhost:5000/api/android/sync"

def get_local_ip():
    """Get the active local IP address of this machine."""
    try:
        # Create dummy connection to retrieve active interface
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except Exception:
        return "127.0.0.1"

import concurrent.futures

def ping_ip(ip):
    is_win = sys.platform.startswith("win")
    if is_win:
        # 1 packet, 100ms timeout
        cmd = ["ping", "-n", "1", "-w", "100", ip]
    else:
        # 1 packet, 1s timeout
        cmd = ["ping", "-c", "1", "-W", "1", ip]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ping_subnet(subnet_base):
    """Ping all IPs in the subnet base (1 to 254) in parallel using thread pools."""
    print(f"[*] Sweeping entire subnet {subnet_base}.1 to {subnet_base}.254 in parallel...")
    ips = [f"{subnet_base}.{i}" for i in range(1, 255)]
    
    # Use 100 concurrent threads to sweep the network in less than 2 seconds
    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
        executor.map(ping_ip, ips)
    print("[+] Subnet sweep complete. ARP cache populated.")

def parse_arp_table(local_ip_prefix):
    """Parse system ARP cache table to extract connected MACs and IPs."""
    clients = []
    try:
        is_win = sys.platform.startswith("win")
        if is_win:
            # Windows command output:
            #   192.168.43.15        7c-c3-a1-8f-54-12     dynamic
            output = subprocess.check_output(["arp", "-a"], text=True)
            # Match IPv4 addresses and MAC address patterns
            pattern = re.compile(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F\-]{17})")
            for line in output.splitlines():
                match = pattern.search(line)
                if match:
                    ip, mac = match.groups()
                    mac = mac.replace("-", ":").lower()
                    # Skip broadcast and local machine gateway
                    if not ip.endswith(".255") and ip.startswith(local_ip_prefix) and mac != "ff:ff:ff:ff:ff:ff":
                        clients.append({"ip": ip, "mac": mac})
        else:
            # Linux/Mac command output:
            #   ? (192.168.43.15) at 7c:c3:a1:8f:54:12 [ether] on wlan0
            output = subprocess.check_output(["arp", "-n"], text=True)
            pattern = re.compile(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+.*?\s+([0-9a-fA-F:]{17})")
            for line in output.splitlines():
                match = pattern.search(line)
                if match:
                    ip, mac = match.groups()
                    mac = mac.lower()
                    if not ip.endswith(".255") and ip.startswith(local_ip_prefix) and mac != "ff:ff:ff:ff:ff:ff":
                        clients.append({"ip": ip, "mac": mac})
    except Exception as e:
        print(f"[!] Error parsing ARP entries: {e}")
    return clients

def main():
    print("=========================================================")
    print("      Smart Hotspot Companion App - Python Bridge        ")
    print("   This script sweeps local network to sync real MACs    ")
    print("=========================================================")

    # Determine subnet prefix
    local_ip = get_local_ip()
    print(f"[*] Identified Active Interface IP: {local_ip}")
    
    parts = local_ip.split(".")
    if len(parts) == 4 and parts[0] != "127":
        subnet_prefix = f"{parts[0]}.{parts[1]}.{parts[2]}"
    else:
        # Default typical Android Hotspot network subnet
        subnet_prefix = "192.168.43"
    
    print(f"[*] Scoping scan subnet prefix: {subnet_prefix}.x")

    # Initial ping sweep to wake up neighbor records
    ping_subnet(subnet_prefix)

    print("[*] Entering synchronization scanner loop (Ctrl+C to stop)...")
    loop_count = 0
    local_blocked = set()
    
    while True:
        try:
            loop_count += 1
            if loop_count > 1 and loop_count % 3 == 0:
                # Re-sweep to discover newly connected clients
                ping_subnet(subnet_prefix)

            # Find MAC-IP neighbors
            raw_clients = parse_arp_table(subnet_prefix)
            
            # Map client objects with mock transfer rate values
            sync_list = []
            for c in raw_clients:
                # Filter out own computer IP
                if c["ip"] == local_ip:
                    continue
                # Skip locally blocked MACs (simulate device network block)
                if c["mac"].lower() in local_blocked:
                    continue
                sync_list.append({
                    "mac": c["mac"],
                    "ip": c["ip"],
                    "tx_rate": round(0.1 + (0.5 * (hash(c["mac"]) % 5) / 5), 2),
                    "rx_rate": round(0.5 + (2.5 * (hash(c["ip"]) % 5) / 5), 2)
                })

            print(f"[*] Discovered {len(sync_list)} neighbor nodes: {[c['mac'] for c in sync_list]}")
            if local_blocked:
                print(f"[*] Simulating block/kick on MACs: {list(local_blocked)}")

            # Send sync list payload to Flask backend
            payload = {"client_macs": sync_list}
            res = requests.post(API_URL, json=payload, timeout=5)
            
            if res.status_code == 200:
                data = res.json()
                print(f"[+] Sync success. Server settings limit: {data.get('max_devices')}")
                
                # Check block commands returned by backend
                blocked = data.get("blocked_macs", [])
                # Sync our local blocklist with the database
                local_blocked = set(b.lower() for b in blocked)
                
                if blocked:
                    print(f"[⚠️ WARNING] Commands received to BLOCK/DISCONNECT MACs: {blocked}")
            else:
                print(f"[!] Sync endpoint returned code {res.status_code}")
                
        except requests.exceptions.ConnectionError:
            print("[!] Connection failed: Is Flask backend server.py running on port 5000?")
        except Exception as ex:
            print(f"[!] Error in scanner loop: {ex}")
            
        time.sleep(8.0) # Check every 8 seconds

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[*] Scanner halted.")
        sys.exit(0)
