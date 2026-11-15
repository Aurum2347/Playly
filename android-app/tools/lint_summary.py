import os, sys, xml.etree.ElementTree as E

root = E.parse(sys.argv[1]).getroot()
for issue in root:
    loc = issue.find("location")
    where = ""
    if loc is not None:
        where = os.path.basename(loc.get("file", "")) + ":" + (loc.get("line") or "")
    print(issue.get("severity"), issue.get("id"), "|", where, "|", issue.get("message")[:160])
