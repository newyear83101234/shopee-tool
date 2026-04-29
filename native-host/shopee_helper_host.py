#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""蝦皮快速上架助手 - Native Messaging Host (精簡版)
只負責讀寫 D:\shopee-data 資料夾的 JSON 檔案，讓不同 Chrome Profile 共用資料。
"""
import sys, os, json, struct

DATA_DIR = r"D:\shopee-data"

def ensure_dir():
    os.makedirs(DATA_DIR, exist_ok=True)

def read_msg():
    raw = sys.stdin.buffer.read(4)
    if not raw or len(raw) < 4:
        sys.exit(0)
    length = struct.unpack('I', raw)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode('utf-8'))

def send_msg(obj):
    encoded = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

def load_json(filename):
    path = os.path.join(DATA_DIR, filename)
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None

def save_json(filename, data):
    ensure_dir()
    path = os.path.join(DATA_DIR, filename)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

FILE_MAP = {
    'load_settings': 'settings.json',
    'save_settings': 'settings.json',
    'load_product': 'product.json',
    'save_product': 'product.json',
    'load_titles': 'titles.json',
    'save_titles': 'titles.json',
}

def main():
    ensure_dir()
    msg = read_msg()
    action = msg.get('action', '')

    if action == 'ping':
        send_msg({'success': True, 'version': '4.1'})
        return

    filename = FILE_MAP.get(action)
    if not filename:
        send_msg({'success': False, 'error': f'Unknown action: {action}'})
        return

    if action.startswith('load_'):
        data = load_json(filename)
        send_msg({'success': True, 'data': data})
    elif action.startswith('save_'):
        save_json(filename, msg.get('data'))
        send_msg({'success': True})

if __name__ == '__main__':
    main()
