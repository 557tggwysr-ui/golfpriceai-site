# GolfPrice AI — Step-by-Step Launch Guide

This is a plain, no-detours walkthrough to get your site live on GitHub Pages
and the auto-updater running. Every step tells you exactly what to click.
No Framer, no Airtable, no CMS field-mapping — just these steps, once.

---

## PART 1 — Create your GitHub account

1. Go to **github.com**
2. Click **Sign up** (top right)
3. Enter your email, create a password, choose a username
4. Verify your email when it sends you the code

*Skip this whole part if you already have a GitHub account.*

---

## PART 2 — Create the repository (this is just "the folder that holds your site")

1. Once logged in, click the **+** icon top right → **New repository**
2. Repository name: type `golfpriceai-site`
3. Leave everything else as default
4. Click the green **Create repository** button
5. You'll land on an empty repository page — keep this tab open

---

## PART 3 — Upload your website files

1. On that empty repository page, click **uploading an existing file**
   (it's a blue link in the middle of the page)
2. On your computer, unzip the `golfpriceai-site.zip` file I gave you
3. Open the unzipped folder
4. Select **everything inside it** (all files and folders) and drag them
   all into the browser window
5. Scroll down, click the green **Commit changes** button
6. Wait for the page to finish uploading (progress bar at the top)

---

## PART 4 — Turn the site "on" (GitHub Pages)

1. In your repository, click **Settings** (top menu, far right)
2. In the left sidebar, click **Pages**
3. Under "Build and deployment" → "Branch", click the dropdown
   showing "None" and change it to **main**
4. Leave the folder as **/ (root)**
5. Click **Save**
6. Wait about 1 minute, then refresh the page — a green box appears
   with your live web address, e.g.
   `https://yourusername.github.io/golfpriceai-site/`
7. Click that link — **your site is now live on the internet**

---

## PART 5 — Connect your own domain (the one you already own)

1. Still on **Settings → Pages**, find the **Custom domain** box
2. Type your domain (e.g. `golfpriceai.com`) and click **Save**
3. GitHub will show a message saying DNS check is in progress — that's normal
4. Now go to wherever you bought your domain (GoDaddy, Namecheap, 123-reg, etc.)
5. Find **DNS settings** / **Manage DNS** for your domain
6. Add these two records exactly (GitHub's own docs page also shows these
   if you search "GitHub Pages custom domain DNS"):

   | Type | Name | Value |
   |------|------|-------|
   | A | @ | 185.199.108.153 |
   | A | @ | 185.199.109.153 |
   | A | @ | 185.199.110.153 |
   | A | @ | 185.199.111.153 |
   | CNAME | www | yourusername.github.io |

7. Save those records at your registrar
8. Go back to GitHub → **Settings → Pages** → tick **Enforce HTTPS**
   (it may take up to 24 hours to appear as an option — that's normal, DNS
   just needs time to spread)

**Your site is now live on your own domain.** Nothing left to do in this part.

---

## PART 6 — Confirm the auto-updater is running

You don't need to set this up — it's already inside the files you uploaded
and switches itself on the moment Part 3 is done. To just double check it:

1. In your repository, click the **Actions** tab (top menu)
2. You should see a workflow called **"Update golf deals"**
3. It will show runs happening automatically every 6 hours from now on
4. Nothing to click here — this tab is just for you to glance at

---

## PART 7 — Affiliate programs (the one part only you can do)

These need your name, address and bank details, so I can't do this step —
but each is one sign-up form, about 15–20 minutes total:

1. **Amazon Associates** — associates.amazon.com — usually instant approval
2. **CJ Affiliate** — cj.com — carries Golf Galaxy, Dick's Sporting Goods
3. **AWIN** — awin.com — carries TGW (The Golf Warehouse)
4. **Impact** — impact.com — carries PGA Tour Superstore

Once you're approved by any one of them:

1. In their dashboard, find your **API key** and your **tracking/publisher ID**
2. In your GitHub repository: **Settings → Secrets and variables → Actions**
3. Click **New repository secret**, name it (e.g. `CJ_API_KEY`), paste the key, save
4. Come back to a Claude chat, tell me which network you got approved for
   and paste me a link to their API docs — I'll then write the real code
   that pulls their live prices into your site. That's the last piece,
   and it only needs doing once per network.

---

## Privacy Policy, Cookie Policy & cookie banner

This update adds `legal/privacy-policy.html`, `legal/cookies.html`, and a
cookie consent banner (`js/cookie-consent.js`) that appears on every page
until a visitor accepts or declines. Both pages are linked from the site
footer. One thing to update yourself: the contact email in both pages is
currently a placeholder (`hello@golfpriceai.com`) — swap it for a real
inbox you'll actually check, either by setting one up at your domain
registrar or forwarding it to your personal email.

I'm not a lawyer, and this is standard boilerplate suited to a small
affiliate site, not a substitute for professional legal advice — if you
plan to scale this into a serious business, it's worth a solicitor's
once-over eventually, but this covers the basics properly for now.

## A note on the current product photos

Until you complete Part 7, the cards use free, properly-licensed lifestyle
photos from Pexels (no attribution required, free for commercial use) that
match each product's *category* — a driver photo for drivers, a putter
photo for putters, etc. — rather than being an exact photo of that specific
model, since only a licensed retailer feed can provide that. The moment
Part 7 is done and a real feed is wired in, actual per-product photos take
over automatically — nothing else needs to change.

## That's the whole thing

Once Parts 1–4 are done, your site is permanently live, free, and the deal
data refreshes itself. Part 5 just points your existing domain at it. Part 7
is what turns it from sample data into real, revenue-generating deals —
and it's the only part that can't be done by anyone but you (it's tied to
your bank details), but it's a form, not a website builder.

Any time after this, if you want something changed — new colours, an extra
section, a different layout — just tell me in a Claude chat and I'll hand
you updated files to re-upload (drag-and-drop over Part 3 again, same as
the first time).
