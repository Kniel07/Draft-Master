#!/usr/bin/env python3
"""
generate_heroes.py
------------------
Optional authoring helper. Expands the compact hero table below into
../data/heroes.json.

You do NOT need this script to run or update the app. data/heroes.json is
plain, hand-editable JSON. This exists only so that bulk edits (a new patch
touching 30 heroes) stay consistent instead of drifting row by row.

Row format:
  id | Name | classes | lanes | tags | meta

Stats (early, late, damage, survivability, cc, push, coordination) are derived
from the primary class baseline plus tag modifiers, then clamped to 5..99.
Anything derived can be overridden by hand afterwards in heroes.json.
"""

import json
import os
from datetime import date

PATCH = "2.1.90"
PATCH_DATE = "2026-07-08"

# Primary-class baselines: early, late, damage, survivability, cc, push, coordination
BASELINE = {
    "Tank":     (70, 62, 28, 88, 80, 35, 85),
    "Support":  (66, 66, 34, 62, 72, 32, 88),
    "Fighter":  (72, 68, 66, 74, 50, 60, 58),
    "Assassin": (74, 66, 86, 42, 38, 55, 50),
    "Mage":     (68, 76, 84, 44, 60, 58, 62),
    "Marksman": (52, 88, 82, 38, 30, 78, 55),
}

KEYS = ("early", "late", "damage", "survivability", "cc", "push", "coordination")

# Tag -> stat deltas
TAG_MODS = {
    "hard-cc":         {"cc": 10},
    "aoe-cc":          {"cc": 12, "coordination": 6},
    "setup":           {"coordination": 8, "cc": 4},
    "engage":          {"coordination": 8, "survivability": 4},
    "disengage":       {"coordination": 6, "survivability": 6},
    "peel":            {"coordination": 8, "survivability": 4},
    "burst":           {"damage": 8, "late": -2},
    "sustained-damage": {"damage": 6, "late": 4},
    "poke":            {"early": 6, "damage": 4},
    "sustain":         {"survivability": 10},
    "shield":          {"survivability": 6, "coordination": 4},
    "heal":            {"survivability": 8, "coordination": 8},
    "anti-heal":       {"damage": 2},
    "true-damage":     {"damage": 6},
    "tank-shred":      {"damage": 6},
    "mobility":        {"survivability": 6},
    "blink":           {"survivability": 6, "damage": 2},
    "backline-access": {"damage": 6, "coordination": -4},
    "frontline":       {"survivability": 8},
    "zoning":          {"cc": 6, "coordination": 4},
    "immunity":        {"survivability": 8},
    "purify":          {"survivability": 4, "coordination": 4},
    "scaling":         {"late": 10, "early": -8},
    "early-game":      {"early": 10, "late": -8},
    "split-push":      {"push": 14, "coordination": -6},
    "objective":       {"push": 8, "early": 4},
    "global":          {"coordination": 10, "push": 6},
    "vision":          {"coordination": 8},
    "revive":          {"coordination": 8, "survivability": 6},
    "invisible":       {"survivability": 6, "coordination": -4},
    "single-target":   {"damage": 4, "coordination": -2},
    "wave-clear":      {"push": 8},
    "counter-initiate": {"coordination": 6, "cc": 4},
}

# id | Name | classes | lanes | tags | meta
ROWS = """
atlas|Atlas|Tank,Support|roam|aoe-cc,engage,setup,frontline,counter-initiate|88
tigreal|Tigreal|Tank|roam|aoe-cc,engage,setup,frontline|82
khufra|Khufra|Tank|roam|hard-cc,engage,frontline,counter-initiate|84
franco|Franco|Tank|roam|hard-cc,single-target,engage,frontline|78
grock|Grock|Tank|roam,exp|aoe-cc,engage,zoning,frontline|74
hylos|Hylos|Tank|roam|aoe-cc,frontline,sustain,engage|76
lolita|Lolita|Tank,Support|roam|aoe-cc,shield,peel,counter-initiate|72
minotaur|Minotaur|Tank,Support|roam|aoe-cc,heal,frontline|70
johnson|Johnson|Tank,Support|roam|hard-cc,global,engage,frontline|74
akai|Akai|Tank|roam,jungle|aoe-cc,zoning,engage,frontline|76
belerick|Belerick|Tank|roam|peel,frontline,sustain,zoning|68
gatotkaca|Gatotkaca|Tank,Fighter|roam,exp|aoe-cc,engage,frontline|70
baxia|Baxia|Tank|roam,jungle|anti-heal,mobility,frontline,objective|80
edith|Edith|Tank,Marksman|roam,exp|aoe-cc,scaling,frontline,engage|74
uranus|Uranus|Tank|exp|sustain,frontline,wave-clear|72
chip|Chip|Tank,Support|roam|global,engage,peel,frontline|78
carmilla|Carmilla|Support,Tank|roam|aoe-cc,peel,sustain|66
kaja|Kaja|Support,Fighter|roam|hard-cc,single-target,engage,backline-access|76
mathilda|Mathilda|Support,Assassin|roam|mobility,peel,engage,disengage|82
angela|Angela|Support|roam|shield,heal,global,peel|80
rafaela|Rafaela|Support|roam|heal,purify,peel|66
estes|Estes|Support|roam|heal,sustain,peel|70
floryn|Floryn|Support|roam|heal,global,sustain|72
diggie|Diggie|Support|roam|purify,disengage,vision,peel|74
faramis|Faramis|Support,Mage|roam,mid|revive,aoe-cc,zoning|72
selena|Selena|Assassin,Mage|roam,mid|hard-cc,burst,vision,poke|84
lancelot|Lancelot|Assassin|jungle|mobility,burst,immunity,backline-access|82
ling|Ling|Assassin|jungle|mobility,burst,backline-access,scaling|80
hayabusa|Hayabusa|Assassin|jungle|mobility,burst,split-push,backline-access|78
fanny|Fanny|Assassin|jungle|mobility,burst,early-game,backline-access|76
gusion|Gusion|Assassin,Mage|jungle,mid|blink,burst,backline-access|78
karina|Karina|Assassin,Mage|jungle|true-damage,burst,mobility,backline-access|74
aamon|Aamon|Assassin|jungle|invisible,burst,backline-access|72
joy|Joy|Assassin|jungle|mobility,immunity,burst,backline-access|82
nolan|Nolan|Assassin|jungle|mobility,burst,backline-access,sustained-damage|84
yin|Yin|Assassin,Fighter|jungle|single-target,burst,mobility|76
julian|Julian|Fighter,Mage|jungle,exp|hard-cc,burst,mobility,sustained-damage|82
suyou|Suyou|Assassin,Fighter|jungle|mobility,burst,backline-access|76
hirara|Hirara|Assassin|jungle|mobility,burst,backline-access|74
lukas|Lukas|Fighter|jungle,exp|sustain,burst,mobility|72
fredrinn|Fredrinn|Fighter,Tank|jungle,exp|aoe-cc,sustain,frontline,tank-shred|84
barats|Barats|Tank,Fighter|jungle,exp|hard-cc,scaling,frontline,tank-shred|70
martis|Martis|Fighter|jungle,exp|true-damage,mobility,hard-cc,objective|72
roger|Roger|Marksman,Fighter|jungle,gold|mobility,burst,early-game|70
alpha|Alpha|Fighter|jungle,exp|sustained-damage,sustain,objective|66
aulus|Aulus|Fighter|jungle,exp|sustained-damage,mobility,split-push|78
balmond|Balmond|Fighter|jungle,exp|sustain,tank-shred,wave-clear|62
helcurt|Helcurt|Assassin|jungle|invisible,burst,single-target,backline-access|64
natalia|Natalia|Assassin|jungle|invisible,burst,single-target|66
saber|Saber|Assassin|jungle|single-target,burst,backline-access|64
yi-sun-shin|Yi Sun-shin|Marksman,Assassin|jungle|global,objective,poke,mobility|74
hanzo|Hanzo|Assassin|jungle|scaling,burst,split-push,single-target|68
paquito|Paquito|Fighter|jungle,exp|burst,mobility,hard-cc|80
alucard|Alucard|Fighter|jungle,exp|sustain,mobility,sustained-damage|68
freya|Freya|Fighter|jungle,exp|burst,mobility,sustain|72
zilong|Zilong|Fighter,Assassin|jungle,exp|split-push,mobility,backline-access|66
arlott|Arlott|Fighter,Assassin|exp,jungle|hard-cc,mobility,burst|82
pharsa|Pharsa|Mage|mid|poke,burst,zoning,wave-clear|80
kagura|Kagura|Mage|mid|burst,mobility,zoning,poke|82
lunox|Lunox|Mage|mid|burst,immunity,sustained-damage|78
valentina|Valentina|Mage|mid|burst,mobility,counter-initiate,zoning|84
cecilion|Cecilion|Mage|mid|scaling,poke,wave-clear,zoning|76
xavier|Xavier|Mage|mid|poke,scaling,global,zoning|78
yve|Yve|Mage|mid|zoning,aoe-cc,poke,wave-clear|76
luo-yi|Luo Yi|Mage|mid|aoe-cc,global,setup,wave-clear|74
vexana|Vexana|Mage|mid|aoe-cc,burst,setup|68
lylia|Lylia|Mage|mid|mobility,zoning,poke,wave-clear|72
change|Chang'e|Mage|mid|poke,sustained-damage,wave-clear,scaling|70
novaria|Novaria|Mage|mid|poke,vision,zoning|76
zhuxin|Zhuxin|Mage|mid|zoning,aoe-cc,sustained-damage|86
eudora|Eudora|Mage|mid|burst,hard-cc,single-target|66
aurora|Aurora|Mage|mid|burst,aoe-cc,setup|70
kadita|Kadita|Mage|mid|burst,immunity,aoe-cc,setup|74
harith|Harith|Mage,Assassin|mid,jungle|mobility,sustained-damage,scaling|76
valir|Valir|Mage|mid|zoning,aoe-cc,poke,disengage|72
nana|Nana|Mage,Support|mid,roam|hard-cc,poke,disengage|70
odette|Odette|Mage|mid|aoe-cc,burst,zoning|64
zhask|Zhask|Mage|mid|split-push,poke,wave-clear|62
gord|Gord|Mage|mid|true-damage,poke,sustained-damage|64
vale|Vale|Mage|mid|aoe-cc,burst,setup|66
marcel|Marcel|Mage,Support|mid|shield,true-damage,poke|72
sora|Sora|Mage|mid|zoning,poke,mobility|70
zetian|Zetian|Mage|mid|zoning,aoe-cc,poke|74
beatrix|Beatrix|Marksman|gold|poke,burst,early-game,split-push|82
brody|Brody|Marksman|gold|burst,poke,mobility|78
claude|Claude|Marksman|gold|scaling,mobility,sustained-damage|76
wanwan|Wanwan|Marksman|gold|scaling,mobility,immunity,backline-access|74
karrie|Karrie|Marksman|gold|true-damage,tank-shred,mobility,scaling|80
bruno|Bruno|Marksman|gold|sustained-damage,poke,early-game|72
melissa|Melissa|Marksman|gold|zoning,disengage,split-push,scaling|78
granger|Granger|Marksman|gold|burst,poke,early-game|76
clint|Clint|Marksman|gold|poke,burst,early-game|70
moskov|Moskov|Marksman|gold|poke,hard-cc,scaling,global|72
irithel|Irithel|Marksman|gold|mobility,sustained-damage,scaling|68
lesley|Lesley|Marksman,Assassin|gold|poke,burst,single-target,backline-access|70
natan|Natan|Marksman,Mage|gold|scaling,sustained-damage,anti-heal|74
ixia|Ixia|Marksman|gold|sustained-damage,zoning,scaling|72
hanabi|Hanabi|Marksman|gold|purify,scaling,wave-clear|64
kimmy|Kimmy|Marksman,Mage|gold,mid|poke,sustained-damage,wave-clear|70
layla|Layla|Marksman|gold|poke,scaling,wave-clear|58
miya|Miya|Marksman|gold|scaling,immunity,objective|60
popol-and-kupa|Popol and Kupa|Marksman|gold|hard-cc,vision,zoning|66
bane|Bane|Mage,Fighter|gold,exp|poke,objective,sustained-damage|68
yu-zhong|Yu Zhong|Fighter|exp|sustain,aoe-cc,mobility,frontline|82
terizla|Terizla|Fighter|exp|hard-cc,sustain,tank-shred,frontline|74
xborg|X.Borg|Fighter|exp|true-damage,sustain,zoning,tank-shred|76
esmeralda|Esmeralda|Mage,Tank|exp|sustain,shield,split-push,frontline|84
thamuz|Thamuz|Fighter|exp|sustain,true-damage,frontline|72
dyrroth|Dyrroth|Fighter|exp|burst,tank-shred,mobility|76
khaleed|Khaleed|Fighter|exp|sustain,mobility,aoe-cc|70
guinevere|Guinevere|Fighter,Mage|exp|aoe-cc,burst,setup,mobility|74
ruby|Ruby|Fighter,Tank|exp,roam|aoe-cc,sustain,setup,frontline|76
argus|Argus|Fighter|exp|immunity,split-push,sustained-damage|70
badang|Badang|Fighter|exp|hard-cc,burst,zoning|68
silvanna|Silvanna|Fighter,Mage|exp|hard-cc,single-target,backline-access|72
phoveus|Phoveus|Fighter|exp|counter-initiate,sustain,frontline|66
gloo|Gloo|Tank,Fighter|exp,roam|hard-cc,sustain,zoning,frontline|70
cici|Cici|Fighter|exp|sustain,mobility,poke,split-push|78
chou|Chou|Fighter|exp,roam|hard-cc,immunity,peel,backline-access|84
masha|Masha|Fighter|exp|split-push,sustain,objective|66
minsitthar|Minsitthar|Fighter|exp|hard-cc,zoning,counter-initiate|64
leomord|Leomord|Fighter|exp|sustained-damage,mobility,hard-cc|68
hilda|Hilda|Fighter,Tank|exp|sustain,burst,frontline,objective|64
lapu-lapu|Lapu-Lapu|Fighter|exp|aoe-cc,burst,sustain|72
alice|Alice|Mage,Tank|exp,mid|sustain,aoe-cc,scaling,frontline|70
benedetta|Benedetta|Assassin,Fighter|exp,jungle|mobility,immunity,split-push,burst|74
obsidia|Obsidia|Mage,Fighter|exp,mid|zoning,sustained-damage,sustain|72
kalea|Kalea|Support,Tank|roam|hard-cc,peel,engage,frontline|76
"""


def clamp(v, lo=5, hi=99):
    return max(lo, min(hi, int(round(v))))


def build():
    heroes = []
    seen = set()
    for line in ROWS.strip().splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 6:
            raise ValueError("Malformed row: %s" % line)
        hid, name, classes, lanes, tags, meta = parts
        if hid in seen:
            raise ValueError("Duplicate hero id: %s" % hid)
        seen.add(hid)

        class_list = [c.strip() for c in classes.split(",") if c.strip()]
        lane_list = [l.strip() for l in lanes.split(",") if l.strip()]
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

        base = BASELINE[class_list[0]]
        stats = dict(zip(KEYS, base))

        # Secondary class pulls stats 25% toward its own baseline.
        if len(class_list) > 1:
            second = dict(zip(KEYS, BASELINE[class_list[1]]))
            for k in KEYS:
                stats[k] = stats[k] * 0.75 + second[k] * 0.25

        for tag in tag_list:
            for k, delta in TAG_MODS.get(tag, {}).items():
                stats[k] += delta

        heroes.append({
            "id": hid,
            "name": name,
            "classes": class_list,
            "lanes": lane_list,
            "tags": tag_list,
            "meta": int(meta),
            "stats": {k: clamp(stats[k]) for k in KEYS},
        })

    heroes.sort(key=lambda h: h["name"].lower())
    return {
        "patch": PATCH,
        "patchDate": PATCH_DATE,
        "generated": date.today().isoformat(),
        "note": "meta = 0-100 competitive priority for this patch. Edit freely; "
                "the app reads this file at runtime and never hardcodes hero data.",
        "heroes": heroes,
    }


if __name__ == "__main__":
    out_dir = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.abspath(os.path.join(out_dir, "heroes.json"))
    payload = build()
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print("Wrote %d heroes to %s" % (len(payload["heroes"]), out_path))
