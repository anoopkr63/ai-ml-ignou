# IGNOU MSc AI & ML Study Materials

Course blocks, lab manuals and assignments for IGNOU's MSc (Artificial Intelligence and Machine Learning), in one searchable page.

**Live site: [ai-ml-ignou.vercel.app](https://ai-ml-ignou.vercel.app)**

Open any unit in the browser or download it. Search by course code, unit name or topic, and collapse courses you don't need.

## What's included

**Semester I**

| Code | Course | Files |
| --- | --- | --- |
| MCS-061 | Mathematical Foundations-I | 16 |
| MCS-081 | Artificial Intelligence | 16 |
| MCS-082 | Programming Using Python | 8 |
| MCS-208 | Data Structures and Algorithms | 16 |
| MCSL-083 | Programming and AI Lab | 2 |
| MCSL-209 | Data Structures and Algorithms Lab | 1 |
| | Assignments 2026 (question papers) | 6 |

**Semester II**

| Code | Course | Files |
| --- | --- | --- |
| MCS-207 | Database Management Systems | 19 |

MCS-082 is incomplete: Block 2 has only Unit 8, and Block 3 has only Units 9 and 10. Contributions welcome.

## Contributing

Missing a unit, or found a wrong file? Fork the repo, add the PDF in the right folder, and open a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) for the folder and file naming the site relies on. You can also [open an issue](https://github.com/anoopkr63/ai-ml-ignou/issues/new).

Assignment solutions are intentionally not published.

## Running locally

Requires [Bun](https://bun.sh).

```
bun run dev
```

`scripts/build.mjs` reads the `Semester-*` folders and generates the site into `dist/`. The page template, styles and script live in `src/`. Vercel runs the same build on every push to `main`.

## Disclaimer

All course material is © Indira Gandhi National Open University (IGNOU), shared here for study purposes. This project is not affiliated with IGNOU.
