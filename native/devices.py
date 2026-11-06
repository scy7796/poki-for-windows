#!/usr/bin/env python3
"""Read the public usbmuxd device inventory without opening pairing records.

macOS and Linux reach usbmuxd over its Unix domain socket. Windows has no Unix
socket for it: the Apple USB service listens on the loopback TCP port that
idevice also defaults to. USBMUXD_SOCKET_ADDRESS overrides either form; a value
carrying a colon is treated as host:port.
"""
import json
import os
import plistlib
import socket
import struct
import sys

TCP_PORT = 27015
DEFAULT_ADDRESS = '127.0.0.1:%d' % TCP_PORT


def address():
    configured = os.environ.get('USBMUXD_SOCKET_ADDRESS', '').strip()
    if configured:
        return configured
    if sys.platform.startswith('win') or sys.platform == 'cygwin':
        return DEFAULT_ADDRESS
    return '/var/run/usbmuxd'


def connect(target):
    if ':' in target and not target.startswith('/'):
        host, _, port = target.rpartition(':')
        connection = socket.create_connection((host or '127.0.0.1', int(port)), timeout=5)
        return connection
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(5)
    connection.connect(target)
    return connection


def main():
    with connect(address()) as connection:
        connection.settimeout(5)
        body = plistlib.dumps({
            'MessageType': 'ListDevices',
            'ClientVersionString': 'poki-mcp',
            'ProgName': 'poki-mcp',
            'kLibUSBMuxVersion': 3,
        })
        connection.sendall(struct.pack('<IIII', len(body) + 16, 1, 8, 1) + body)

        def receive(length):
            data = bytearray()
            while len(data) < length:
                chunk = connection.recv(length - len(data))
                if not chunk:
                    raise RuntimeError('usbmuxd closed before completing its response')
                data.extend(chunk)
            return data

        length, version, kind, tag = struct.unpack('<IIII', receive(16))
        if not 16 <= length <= 8 * 1024 * 1024:
            raise RuntimeError('Invalid usbmuxd response size')
        response = plistlib.loads(receive(length - 16))
        if response.get('Number', 0) != 0:
            raise RuntimeError('usbmuxd rejected ListDevices')
        devices = []
        for device in response.get('DeviceList', []):
            properties = device.get('Properties', {})
            devices.append({
                'id': properties.get('SerialNumber'),
                'connection': properties.get('ConnectionType'),
            })
    print(json.dumps(devices))


if __name__ == '__main__':
    try:
        main()
    except OSError as error:
        # The usual cause is that the Apple mobile device service is not running, which on
        # Windows means the Apple Devices app or iTunes is closed. An empty inventory is a
        # legitimate answer; the reason goes to stderr so a caller that only reads the list
        # still gets a usable, empty one instead of a Python traceback.
        print(f'Cannot reach the Apple mobile device service at {address()}: {error}. Start the Apple Devices app and connect the iPhone over USB.', file=sys.stderr)
        print('[]')
