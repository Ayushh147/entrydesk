# SWE Intern assignment submission

This folder is the standalone repository to publish and submit.

| Requested deliverable | Location |
| --- | --- |
| TypeScript frontend and backend, with run instructions | `src/`, `server/`, `shared/`, `README.md` |
| Generated shipment entry XML | [output/sample-entry-draft.xml](output/sample-entry-draft.xml) |
| Additional information and unresolved steps | [output/sample-review.json](output/sample-review.json), README shipment section |
| One-page approach writeup | [output/approach.pdf](output/approach.pdf) |
| Selected AI chat excerpts (not complete history) | [output/ai-chat-history.md](output/ai-chat-history.md) |

The original three shipment PDFs, vendor schema/WSDL snapshots, official port-code reference, tests and reproducibility scripts are included.

The supplied entry remains a draft because the documents disagree and broker IDs/full classifications are unavailable. The README explains those limits. No live filing, deployed link or GitHub publication is claimed.

Run `npm ci` then `npm run dev`. See README for the xmllint dependency and checks. GitHub commands are in [GITHUB_PUSH.md](GITHUB_PUSH.md).

The included chat file is a clearly labeled selection of actual prompts and responses, not the complete conversation. It preserves relevant research, corrections, limitations and user feedback. The assignment explicitly requests complete AI history; the selection should not be represented as fulfilling that requirement by itself. The full user-visible transcript is retained locally at `../output/ai-chat-history-full.md` and can be supplied separately if required.
