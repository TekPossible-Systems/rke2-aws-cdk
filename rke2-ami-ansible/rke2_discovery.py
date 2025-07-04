import os
import time
import socket

__IP_RANGE_NETWORK = "10.12.0"
__TIMEOUT = 0.05 # 2 Seconds to timeout socket connection

__HOSTS = []

hostip = os.popen("hostname -i").read().strip()
tailscale_ip = "TAILSCALE_SERVER"

def search_for_servers():
    hosts = []
    for i in range(1,256):
        ipaddr = __IP_RANGE_NETWORK + "." + str(i)
        if (ipaddr == hostip) or (ipaddr == tailscale_ip):    
            continue
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(__TIMEOUT)
        try:
            s.connect((ipaddr, 6443))
            hosts.append(ipaddr + ":6443")
        except Exception as e:
            continue
        finally:
            s.close()
    
    if hosts != []:
        return(hosts)
    
    for i in range(1,256):
        ipaddr = __IP_RANGE_NETWORK + "." + str(i)
        if (ipaddr == tailscale_ip):    
            continue
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(__TIMEOUT)
        try:
            s.connect((ipaddr, 22))
            hosts.append(ipaddr + ":22")
        except:
            continue
        finally:
            s.close()
    return(hosts)

while __HOSTS == []:
    __HOSTS = search_for_servers()

__HOSTS.sort()

print(__HOSTS[0])