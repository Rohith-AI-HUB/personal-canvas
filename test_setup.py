import os

os.makedirs('test_files', exist_ok=True)

with open('test_files/notes.txt', 'w') as f:
    f.write('This is a test note about neural networks and machine learning.\nDeep learning is a subset of ML.')

with open('test_files/readme.md', 'w') as f:
    f.write('# Test Readme\n\nThis is a markdown document about transformers and attention mechanisms.')

with open('test_files/model.py', 'w') as f:
    f.write('import torch\nimport torch.nn as nn\n\nclass SimpleModel(nn.Module):\n    def __init__(self):\n        super().__init__()\n        self.linear = nn.Linear(10, 1)\n\n    def forward(self, x):\n        return self.linear(x)\n')

with open('test_files/config.json', 'w') as f:
    f.write('{"model": "gpt-4", "temperature": 0.7, "max_tokens": 1000}')

with open('test_files/data.csv', 'w') as f:
    f.write('name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,Chicago')

with open('test_files/utils.ts', 'w') as f:
    f.write('export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport const PI = 3.14159;\n')

with open('test_files/shell_script.sh', 'w') as f:
    f.write('#!/bin/bash\necho "Hello World"\nls -la\n')

print('Test files created:')
for fn in sorted(os.listdir('test_files')):
    size = os.path.getsize(f'test_files/{fn}')
    print(f'  {fn} ({size} bytes)')
