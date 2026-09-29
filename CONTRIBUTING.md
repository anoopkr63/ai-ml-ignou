# Contributing

Thanks for helping keep these materials complete. You can add missing units, fix wrong files, or improve the site.

## Adding or fixing a PDF

1. Fork this repo and create a branch.
2. Put the PDF in the right folder, named like the existing files. The site reads these names to build the page:

   ```
   Semester-I/
     MCS-061 Mathematical Foundations-I/        <course code> <course name>
       Block-1 Set, Relations and Functions/    Block-<n> <block name>
         00 Block-1 Introduction - ....pdf      block introduction
         Unit-01 Introduction to Sets.pdf       Unit-<nn> <unit name>
     MCSL-083 Programming and AI Lab/
       Section-01 Python Programming Lab.pdf    lab manuals: Section-<nn> <name>
     Assignments/
       MCS-061 Assignment 2026.pdf              <course code> Assignment <year>
   ```

   A new semester is just a new `Semester-<n>` folder.
3. Keep each file under 50 MB.
4. Open a pull request against `main`.

Please don't upload assignment solutions. The site intentionally leaves them out.

## Changing the site

The page is generated from the folders by `scripts/build.mjs`. The template, styles and script are in `src/`.

```
bun run dev
```

This builds into `dist/` and serves it locally. Check that the page looks right before opening a pull request.

## Reporting a problem

If you can't fix something yourself, [open an issue](https://github.com/anoopkr63/ai-ml-ignou/issues/new) with the course code and unit.
