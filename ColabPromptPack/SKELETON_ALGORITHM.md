# Python Code Skeletonization Algorithm

This document describes the token compression algorithm used for Python/Colab notebook cells.

## Overview

The algorithm reduces code to its semantic skeleton while preserving:
- **Structure**: imports, class/function signatures, section organization
- **Intent**: what the code does (via summary phrases)
- **Dependencies**: what files are read/written, what's defined

## Compression Decision Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Input: Code Cell                      │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              Is this a duplicate cell?                   │
│         (exact hash match with earlier cell)             │
└─────────────────────────────────────────────────────────┘
        │ YES                               │ NO
        ▼                                   ▼
┌───────────────────┐       ┌─────────────────────────────┐
│ Output:           │       │ Is this a signature variant? │
│ "# Duplicate of   │       │ (same def/class names)       │
│  Cell N (names)"  │       └─────────────────────────────┘
└───────────────────┘               │ YES           │ NO
                                    ▼               ▼
                    ┌───────────────────┐   ┌─────────────────┐
                    │ Output:           │   │ Is cell < 6     │
                    │ "# Variant of     │   │ non-empty lines?│
                    │  Bucket (sig dup  │   └─────────────────┘
                    │  of Cell N): sum" │       │ YES     │ NO
                    └───────────────────┘       ▼         ▼
                                        ┌──────────┐ ┌──────────┐
                                        │ Keep     │ │ Full     │
                                        │ verbatim │ │ skeleton │
                                        │ (no meta)│ │ + meta   │
                                        └──────────┘ └──────────┘
```

## Element Handling Rules

### 1. Imports
**Action**: KEEP all, sorted alphabetically
```python
# Input
import os
from collections import Counter
import json

# Output
from collections import Counter
import json
import os
```

### 2. Comments

| Type | Detection | Action |
|------|-----------|--------|
| **Structural** | `# --- Section ---` or `# ========` or `## Header` | KEEP |
| **Explanatory** | Length ≥ 15 chars, describes intent | KEEP |
| **TODO/FIXME** | Starts with TODO, FIXME, NOTE, HACK, XXX, BUG, WARNING | KEEP |
| **Trivial** | Length < 15 chars, not a label | REMOVE |
| **Disabled code** | Looks like commented-out Python (`# func()`, `# x = 1`) | REMOVE |

**Detection for disabled code**:
```
/^[a-z_]\w*\s*\(|^\w+\s*=\s*\w|^(import|from|for|if|while|def|class)\s/i
```

### 3. Function/Class Definitions

**Signature**: Always KEEP (including decorators and multi-line signatures)

**Body handling**:
- If body ≤ 6 non-empty lines → KEEP full body
- If body > 6 lines:
  1. Extract docstring first line → KEEP as `"""summary"""`
  2. Generate summary phrases from body content
  3. Output as `# summary: phrase1, phrase2, phrase3`

```python
# Input (large function)
def build_dataset(df, output_dir):
    """
    Build a TinyRecursiveModels dataset from Coq proofs.

    Args:
        df: DataFrame with proofs
    """
    tokenizer = CoqTokenizer()
    # ... 50 more lines of tokenization, saving, etc.

# Output
def build_dataset(df, output_dir):
    """Build a TinyRecursiveModels dataset from Coq proofs."""
    # summary: tokenizes/encodes text, writes artifacts/checkpoints
```

```python
# Input (small function)
def get_indent(line: str) -> int:
    match = line.match(/^\s*/)
    return len(match[0]) if match else 0

# Output (kept in full)
def get_indent(line: str) -> int:
    match = line.match(/^\s*/)
    return len(match[0]) if match else 0
```

### 4. Variable Assignments

| Classification | Detection | Action |
|----------------|-----------|--------|
| **CONSTANTS** | `NAME = value` where NAME is ALL_CAPS | KEEP |
| **Paths** | Value looks like file path | KEEP |
| **Config** | Name starts with config/params/args/options/settings | KEEP |
| **Referenced** | Name appears 3+ times in code | KEEP |
| **Large objects** | Value contains DataFrame/tensor/model/tokenizer/dataset | SUMMARIZE (mention in contract) |
| **Long values** | Value > 100 chars | REMOVE |
| **Default** | Short values | KEEP |

### 5. Print Statements
**Action**: REMOVE from output, but extract intent for summary phrases

Intent extraction from print messages:
- "Building...", "Creating...", "Generating..." → `building/generating`
- "Loading...", "Reading..." → `loading`
- "Saving...", "Writing..." → `saving`
- "Training...", "Epoch..." → `training progress`
- "Processing..." → `processing`
- "Done", "Finished", "Complete" → `completion`

### 6. Top-Level Calls
**Action**: KEEP shell commands (`!pip`, `!git`) and magic commands (`%cd`, `%%time`)

## Summary Phrase Detection

Patterns matched against code to generate semantic summaries:

| Pattern | Summary Phrase |
|---------|----------------|
| `torch.load`, `load_state_dict`, `.load(` | loads checkpoint/state_dict |
| `torch.save`, `np.save`, `save_pretrained`, `.to_json`, `.to_csv` | writes artifacts/checkpoints |
| `pd.read`, `np.load`, `json.load`, `open(...'r` | reads data files |
| `tokenizer.`, `.tokenize`, `.encode(`, `.decode(` | tokenizes/encodes text |
| `augment`, `shuffle(`, `.sample(` | applies augmentation/sampling |
| `.train(`, `.fit(`, `optimizer.`, `.backward(`, `loss.` | runs training loop |
| `.eval(`, `accuracy`, `top_k`, `metric`, `precision`, `recall` | evaluates metrics |
| `plt.`, `.plot(`, `seaborn`, `sns.` | plots figures |
| `.cuda(`, `.to(device`, `.to("cuda` | moves tensors to device |
| `pad_sequence`, `.pad(`, `max_length=`, `attention_mask` | prepares inputs/masks |
| `DataLoader`, `.batch(`, `collate_fn` | builds batches/dataloaders |
| `.logits`, `softmax(`, `.argmax(` | computes logits/probabilities |
| `!pip`, `pip install`, `requirements.txt` | installs dependencies |
| `!git clone`, `!wget`, `!curl`, `gdown` | downloads external resources |

## Path Detection

Strings are classified as paths if they:
1. Are ≥ 4 characters
2. Do NOT match regex patterns (no `^`, `$`, `\s`, `\d`, `*`, `+`, `?`, etc.)
3. Do NOT contain f-string interpolation (`{var}`)
4. Either:
   - Contain `/` AND (start with `.`, `/`, `~`, drive letter, OR end with file extension)
   - End with known file extensions: `.json`, `.npy`, `.pt`, `.pth`, `.ckpt`, `.csv`, `.parquet`, `.txt`, `.pkl`, `.npz`, `.tsv`, `.jsonl`

## State Contract

Each skeletonized cell includes a contract showing:
- **Defines**: Functions, classes, and top-level assignments
- **Reads**: File paths detected as read operations
- **Writes**: File paths detected as write operations (only shown if non-empty)

```python
# Defines: parse_coq_proof, CoqTokenizer, build_coq_dataset_fixed
# Reads: dataset.json
# Writes: all__inputs.npy, all__labels.npy, all__puzzle_identifiers.npy
```

## Compression Stats

Each skeleton ends with compression statistics:
```
# [python: 191→29 lines, 85% reduced]
```

## Small Cell Optimization

Cells with < 6 non-empty lines that aren't duplicates/variants are output verbatim without metadata overhead to avoid expansion:

```python
# Input (3 lines)
# Clone repo
!git clone https://github.com/example/repo.git
%cd repo

# Output (3 lines, no metadata)
# Clone repo
!git clone https://github.com/example/repo.git
%cd repo
# [python: 3→3 lines, 0% reduced]
```

## Bucket Classification

Cells are classified into buckets for variant detection:
- `setup`: pip install, git clone, apt-get
- `data_acquisition`: wget, curl, download, file extensions
- `dataset_build`: dataset, dataloader, tokenizer, augment
- `training_invocation`: train, fit, optimizer, backward
- `checkpoint_handling`: checkpoint, state_dict, torch.save/load
- `model_load`: from_pretrained, AutoModel, load_model
- `inference_api`: predict, inference, generate, forward
- `evaluation`: eval, accuracy, topk, metric
- `plotting`: plot, matplotlib, seaborn
- `debug_experiments`: print, inspect, pdb, assert
- `other`: default bucket
