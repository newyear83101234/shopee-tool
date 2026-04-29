#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shopee Tool - Install Helper
Collects Extension ID and generates the Native Host config.
"""
import sys, os, json

def main():
    native_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    bat_path = os.path.join(native_dir, "shopee_helper_host.bat")
    json_path = os.path.join(native_dir, "com.shopee.helper.json")

    print()
    print("================================================")
    print("  Open chrome://extensions/ in any Chrome window")
    print("  and copy the ID of the Shopee Tool extension.")
    print("================================================")
    print()

    ext_id = input("  Extension ID: ").strip()

    if not ext_id:
        print("\n[ERROR] No ID entered!")
        sys.exit(1)

    print(f"  [OK] ID: {ext_id}")

    config = {
        "name": "com.shopee.helper",
        "description": "Shopee Helper Native Host",
        "path": bat_path,
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{ext_id}/"]
    }

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    print(f"\n[OK] Config written")
    print(f"     File: {json_path}")

if __name__ == '__main__':
    main()
