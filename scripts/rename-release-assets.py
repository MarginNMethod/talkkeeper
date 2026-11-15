#!/usr/bin/env python3
"""Give the files on a release plain-language names.

The bundler names files after CPU architectures ("aarch64", "x64", "amd64"), which most people
do not know. This renames them, for example TalkKeeper_0.1.2_aarch64.dmg becomes
TalkKeeper-0.1.2-mac-apple-silicon.dmg.

  rename-release-assets.py --list NAME...        print the new name for each given file name
  rename-release-assets.py OWNER/REPO RELEASE_ID  rename the assets of a release (needs gh)
"""
import json
import re
import subprocess
import sys

RULES = [
    (r"^TalkKeeper_(?P<v>[^_]+)_aarch64\.dmg$", "TalkKeeper-{v}-mac-apple-silicon.dmg"),
    (r"^TalkKeeper_(?P<v>[^_]+)_x64\.dmg$", "TalkKeeper-{v}-mac-intel.dmg"),
    (r"^TalkKeeper_(?P<v>[^_]+)_x64-setup\.exe$", "TalkKeeper-{v}-windows-setup.exe"),
    (r"^TalkKeeper_(?P<v>[^_]+)_x64_en-US\.msi$", "TalkKeeper-{v}-windows.msi"),
    (r"^TalkKeeper_(?P<v>[^_]+)_amd64\.AppImage$", "TalkKeeper-{v}-linux.AppImage"),
    (r"^TalkKeeper_(?P<v>[^_]+)_amd64\.deb$", "TalkKeeper-{v}-linux-debian-ubuntu.deb"),
    (r"^TalkKeeper-(?P<v>[^-]+)-1\.x86_64\.rpm$", "TalkKeeper-{v}-linux-fedora.rpm"),
]


def new_name(name):
    for pattern, template in RULES:
        match = re.match(pattern, name)
        if match:
            return template.format(v=match.group("v"))
    return None


def gh(*args):
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def main(argv):
    if argv and argv[0] == "--list":
        for name in argv[1:]:
            print(f"{name} -> {new_name(name) or '(unchanged)'}")
        return 0
    if len(argv) != 2:
        print(__doc__)
        return 2
    repo, release_id = argv
    assets = json.loads(gh("api", f"repos/{repo}/releases/{release_id}/assets?per_page=100"))
    names = {a["name"] for a in assets}
    renamed = 0
    for asset in assets:
        target = new_name(asset["name"])
        if target is None or target in names:
            continue
        gh("api", "-X", "PATCH", f"repos/{repo}/releases/assets/{asset['id']}", "-f", f"name={target}")
        print(f"{asset['name']} -> {target}")
        renamed += 1
    print(f"renamed {renamed} file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
