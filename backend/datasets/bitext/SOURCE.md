# Bitext customer-support FAQ dataset

Derived from the **Bitext Customer Support LLM Chatbot Training Dataset**
(https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset),
file `Bitext_Sample_Customer_Support_Training_Dataset_27K_responses-v11.csv`
(SHA-256 `6f81102b0100b97b8468eb04368033a23206bf1fde9d53500d5806ec1001a434`).

Licence: **CDLA-Sharing-1.0** (Community Data License Agreement – Sharing). This derived data
is shared under the same licence, with attribution to Bitext.

Built by `scripts/build_bitext_dataset.py` (seed 47):

| File | Contents |
| --- | --- |
| `semantic_faq_dataset.csv` | 27 FAQs, one per intent, in 11 categories. The canonical question and concise answer were written for this project from the guidance in the Bitext responses, which are long chatbot replies with `{{placeholders}}`. |
| `faq_alternate_questions.csv` | 270 Bitext utterances (10 per intent) indexed as alternate phrasings |
| `data/bitext_dev_queries.csv` | 540 Bitext utterances (20 per intent), labelled by intent |
| `data/bitext_test_queries.csv` | 23,020 remaining Bitext utterances, labelled by intent (held-out) |
| `data/semantic_faq_*no_match*.csv` | The project's 60 out-of-scope questions, to measure rejection |

Placeholders inside utterances are filled with fixed example values (for example
`{{Order Number}}` → `48213`). 3,042 exact repeated utterances were removed; no utterance
appears under two intents.

Note: Bitext utterances are template-generated paraphrases. Held-out accuracy on them is
higher than on free-form questions. Indexing more Bitext utterances raised held-out top-1
from 92% to 99% but lowered accuracy on independently written natural questions, so 10 per
intent is used.
