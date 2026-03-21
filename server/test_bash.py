import winpty
import time
import os

try:
    proc = winpty.PtyProcess.spawn(r'C:\Program Files\Git\bin\bash.exe --login -i')
    time.sleep(2)
    print("Output:", repr(proc.read()))
    proc.terminate()
except Exception as e:
    print("Error 1:", e)

try:
    proc = winpty.PtyProcess.spawn(r'C:\Program Files\Git\bin\bash.exe')
    time.sleep(2)
    print("Output:", repr(proc.read()))
    proc.terminate()
except Exception as e:
    print("Error 2:", e)
