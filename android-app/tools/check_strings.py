import re, subprocess, sys, xml.dom.minidom as m

root = "app/src/main"
used = set(re.findall(r"R\.(?:string|plurals)\.([a-z_]+)",
                      subprocess.run(["grep", "-rhoE", r"R\.(string|plurals)\.[a-z_]+", root + "/java"],
                                     capture_output=True, text=True).stdout))
names = {}
for loc in ("values", "values-en"):
    doc = m.parse(f"{root}/res/{loc}/strings.xml")
    names[loc] = {e.getAttribute("name") for e in doc.documentElement.childNodes if e.nodeType == 1}
    print(loc, len(names[loc]), "missing:", sorted(used - names[loc] - ({"app_name"} if loc != "values" else set())))
print("unused:", sorted(names["values"] - used))
print("ru-only:", sorted(names["values"] - names["values-en"] - {"app_name"}))
