import glob
import sys
import xml.etree.ElementTree as E

# Summary of connected test results: suites, then each failure with the first lines of its trace.
for f in glob.glob('app/build/outputs/androidTest-results/connected/debug/**/*.xml', recursive=True):
    root = E.parse(f).getroot()
    for suite in root.iter('testsuite'):
        print(suite.get('name'), 'tests', suite.get('tests'), 'fail', suite.get('failures'), 'err', suite.get('errors'))
    for case in root.iter('testcase'):
        for child in list(case):
            if child.tag in ('failure', 'error'):
                text = (child.text or '').strip().splitlines()
                print('FAIL', case.get('classname', '').split('.')[-1], case.get('name'))
                for line in text[:int(sys.argv[1]) if len(sys.argv) > 1 else 6]:
                    print('   ', line.strip()[:220])
