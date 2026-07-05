# Cashbook

A private, offline cashbook you install like an app. Track money across multiple **books**, keep tabs on **parties** (who owes you and whom you owe), separate **Cash in hand** from your **Bank account**, and see clear analytics — all without an account, a server, or an internet connection.

**Your data never leaves your device.** Everything is stored in your browser. There is no cloud, no sign-in, and nobody else can see your numbers.

---

## What it does

- **Multiple books** — one per shop, project, or pocket, each with its own opening balance.
- **Cash in / Cash out** with notes, categories, parties, photos of receipts, and a built-in calculator and cash-note counter.
- **Cash & Bank accounts** — every entry is either Cash or Online, and the two account balances are always kept straight. Move money between them with **Transfer**.
- **Parties** — running "you gave / you got" statements you can share as an image or print.
- **Analytics** — per book and across all books: category breakdowns, in-vs-out, balance over time, budgets, and insights.
- **Recurring entries** (rent, salary…), **budgets**, **30-day trash**, **backup & restore**, **CSV export**, and **print / save-as-PDF** reports.
- **App lock** with a PIN and optional **fingerprint / face unlock** (biometrics need the installed app over HTTPS).
- Works fully **offline** once installed.

---

## Put it online with GitHub Pages (free)

You don't need to know any code. Just upload the files.

1. **Create a GitHub account** at [github.com](https://github.com) if you don't have one.
2. Click the **+** (top right) → **New repository**. Name it `cashbook`. Choose **Public**. Click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Drag in **everything from this folder**:
   - `index.html`
   - `sw.js`
   - `manifest.webmanifest`
   - `.nojekyll`
   - `README.md`
   - the **`icons`** folder (keep it as a folder — don't rename it or move the images out).
5. Click **Commit changes**.
6. Go to the repository's **Settings** → **Pages** (left menu).
7. Under **Build and deployment → Source**, pick **Deploy from a branch**. Set branch to **main** and folder to **/ (root)**. Click **Save**.
8. Wait about a minute, then open:
   ```
   https://YOUR-USERNAME.github.io/cashbook/
   ```
   (Replace `YOUR-USERNAME` with your GitHub username.)

That link is your app. Bookmark it.

---

## Install it on your phone

Open the link above in your phone's browser, then:

- **Android (Chrome):** tap the **⋮** menu → **Install app** (or **Add to Home screen**).
- **iPhone (Safari):** tap the **Share** button → **Add to Home Screen**.

Now it opens like a normal app, full-screen and offline. **Fingerprint / face unlock only works after installing** (it needs the secure HTTPS address, which the GitHub Pages link provides).

---

## Important things to know

- **Data is per-browser, per-device.** What you enter on your phone is not automatically on your laptop. To move data, use **Settings → Share backup** (or **Download backup**) and then **Restore from backup** on the other device.
- **Back up regularly.** The app will remind you. A backup is a single `.json` file you can keep in Drive, email, or WhatsApp to yourself.
- **Updating the app later:** replace `index.html` in your repository with the new version (upload it again and commit). The app updates itself the next time it's opened online.

---

## Troubleshooting

- **Link shows a 404 / "not found":** Pages can take 1–2 minutes after saving. Also confirm the repository is **Public** and Pages source is **main / (root)**.
- **Icons or app look broken:** make sure the **`icons` folder was uploaded as a folder**, with the images still inside it.
- **Fingerprint option is greyed out / says "needs installed app":** open the app from your **Home Screen** (installed), not from a plain browser tab, and make sure the address starts with `https://`.
- **Numbers look wrong for your currency:** open **Settings → Currency** and pick your symbol and digit grouping (e.g. `12,34,567` for South Asia).

---

*Cashbook is a single self-contained web app. No trackers, no ads, no data collection.*
