/* Magic City Culture — HOT UP & COMING data (static file, no database step).
   The upcoming comics most likely to be hot — new #1s, key first
   appearances, event launches, notable variant programs — each with a
   REAL release date (or FOC date, labeled as such) taken from an actual
   source: publisher solicitations and announcements (DC, Marvel, Image,
   IDW), Previews / Penguin Random House listings, Key Collector and
   comic news. Informational only — nothing here is for sale and no
   member's private values are involved.

   REFRESH (see BUILD_NOTES.md, "Hot Up & Coming" section): replace the
   items array and updatedAt below with fresh research, keep the exact
   field shape, never invent a date, a first appearance or a cover,
   verify every coverUrl returns an image before using it
   (coverUrl: null renders the site's placeholder tile), then push
   this single file. */
window.MCC_UPCOMING = {
  updatedAt: "2026-11-27T05:37:52Z",
  sourceNote: "Release dates and details from publisher solicitations and announcements (DC, Marvel, Image, IDW), Previews listings and comic news. Dates can shift — each slide links to its source.",
  items: [
    {
      rank: 1,
      title: "Absolute Justice",
      issue: "#1 (DC, 2027)",
      publisher: "DC",
      releaseDate: "2027-04-07",
      dateLabel: "Releases Apr 7, 2027",
      whyHot: "The FIRST Absolute Universe event — Jason Aaron & Juan Ferreyra unite the Absolute heroes for the first time. $9.99 blind bags hide exclusive foils and 500+ original sketch covers.",
      coverUrl: "https://shop.thirdeyecomics.com/cdn/shop/files/dc-comics-comic-books-absolute-justice-1-of-5-cvr-a-juan-ferreyra-release-date-04-07-2027-76194140049500111-1226dc0001-1268804935_450x.jpg",
      link: "https://www.dc.com/blog/2026-11-17/dc-reveals-full-details-for-absolute-justice-2027"
    },
    {
      rank: 2,
      title: "Spider-Man Noir",
      issue: "#1 (Marvel, 2027)",
      publisher: "Marvel",
      releaseDate: "2027-02-10",
      dateLabel: "Releases Feb 10, 2027",
      whyHot: "First appearance of Venom Noir. Alex Segura & Farid Karami continue the Spider-Noir saga on the page, with Stephen Mooney covers.",
      coverUrl: "https://shop.thirdeyecomics.com/cdn/shop/files/marvel-comic-books-spider-man-noir-1-cover-a-release-date-02-10-2027-75960621759500111-prh-75960621759500111-1268804182_1300x.jpg",
      link: "https://icv2.com/articles/news/view/63604/new-spider-man-related-comics-from-marvel"
    },
    {
      rank: 3,
      title: "Batman",
      issue: "#17 (DC, 2027)",
      publisher: "DC",
      releaseDate: "2027-01-06",
      dateLabel: "Releases Jan 6, 2027",
      whyHot: "Matt Fraction & Jorge Jiménez: after Bruce Wayne's “death,” Batman debuts two new identities — one already revealed: Phantom Lord.",
      coverUrl: "https://bleedingcool.com/wp-content/uploads/2026/11/large-5881180.jpg",
      link: "https://www.keycollectorcomics.com/issue/batman-1-17-1,935124/"
    },
    {
      rank: 4,
      title: "Star Wars | Marvel: Hope Assembles",
      issue: "#1 (Marvel, 2027)",
      publisher: "Marvel",
      releaseDate: "2027-01-13",
      dateLabel: "Releases Jan 13, 2027",
      whyHot: "The first-ever Star Wars × Marvel crossover, for Star Wars' 50th anniversary — Kevin Smith & David Marquez, with Alex Ross and 1:100 virgin variants.",
      coverUrl: "https://images.penguinrandomhouse.com/cover/d/75960621652900111",
      link: "https://bleedingcool.com/comics/official-full-marvel-comics-january-2027-solicits-solicitations/"
    },
    {
      rank: 5,
      title: "Jessica Jones: Alias",
      issue: "#1 (Marvel, 2026)",
      publisher: "Marvel",
      releaseDate: "2026-12-23",
      dateLabel: "Releases Dec 23, 2026",
      whyHot: "Bendis & Gaydos reunite for Jessica's 25th anniversary — David Mack painted covers, an Ito 1:25 and a Mack virgin 1:50.",
      coverUrl: "https://images.penguinrandomhouse.com/cover/d/75960621746500111",
      link: "https://www.marvel.com/articles/comics/jessica-jones-alias-25th-anniversary-series-brian-michael-bendis-michael-gaydos-december-2026"
    },
    {
      rank: 6,
      title: "Maximum X-Men",
      issue: "#1 (Marvel, 2026)",
      publisher: "Marvel",
      releaseDate: "2026-12-02",
      dateLabel: "Releases Dec 2, 2026",
      whyHot: "Christopher Yost & Tony S. Daniel: with the Avengers gone after Armageddon, Storm assembles Earth's Mightiest Mutants.",
      coverUrl: "https://images.penguinrandomhouse.com/cover/d/75960621728100111",
      link: "https://www.marvel.com/comics/issue/138421/maximum_x-men_2026_1"
    },
    {
      rank: 7,
      title: "Angela",
      issue: "#1 (Marvel, 2027)",
      publisher: "Marvel",
      releaseDate: "2027-02-10",
      dateLabel: "Releases Feb 10, 2027",
      whyHot: "Angela's first ongoing series rides her Marvel Rivals breakout — Wes Craig & Pere Pérez, Kaare Andrews covers, Mark Brooks 1:100 virgin.",
      coverUrl: "https://shop.thirdeyecomics.com/cdn/shop/files/marvel-comic-books-angela-1-cover-a-release-date-02-10-2027-75960621758800111-prh-75960621758800111-1268804300_1300x.jpg",
      link: "https://icv2.com/articles/news/view/63892/angela-gets-ongoing-series-marvel"
    },
    {
      rank: 8,
      title: "Batman: Reign of Assassins",
      issue: "#1 (DC, 2027)",
      publisher: "DC",
      releaseDate: "2027-02-17",
      dateLabel: "Releases Feb 17, 2027",
      whyHot: "John Ridley & Olivier Coipel bring both Batmen — Bruce Wayne and Jace Fox — together for the first time; Dan Mora variant cover.",
      coverUrl: "https://shop.thirdeyecomics.com/cdn/shop/files/dc-comics-comic-books-batman-reign-of-assassins-1-of-5-cvr-a-olivier-coipel-release-date-02-17-2027-76194137961600111-1226dc0102-1268804897_450x.jpg",
      link: "https://www.dc.com/blog/2026-11-11/dc-announces-batman-reign-of-assassins"
    },
    {
      rank: 9,
      title: "Teenage Mutant Ninja Turtles: The First Ronin",
      issue: "#1 (IDW, 2027)",
      publisher: "IDW",
      releaseDate: "2027-03-17",
      dateLabel: "Releases Mar 17, 2027",
      whyHot: "Stan Sakai & Soo Lee's feudal-Japan spiritual predecessor to The Last Ronin — 52 pages, 11 covers up to a 1:100 Ito foil.",
      coverUrl: "https://shop.thirdeyecomics.com/cdn/shop/files/idw-publishing-comic-books-teenage-mutant-ninja-turtles-the-first-ronin-1-cover-a-lee-release-date-03-17-2027-82771403640400111-prh-82771403640400111-1268804116_1300x.jpg",
      link: "https://bleedingcool.com/comics/scoop-the-full-official-solicits-for-tmnt-first-ronin-1-for-2027/"
    },
    {
      rank: 10,
      title: "Creature Corps",
      issue: "#1 (Image, 2026)",
      publisher: "Image",
      releaseDate: "2026-12-02",
      dateLabel: "Releases Dec 2, 2026",
      whyHot: "Curt Pires (Fireborn, Lost Fantasy) & Jok launch a giant 64-page #1 with 15 covers — Jae Lee, Tyler Kirkham — plus a companion trading-card game.",
      coverUrl: "https://cdn.imagecomics.com/assets/i/releases/1133745/creature-corps-1_1c89324772.jpg",
      link: "https://imagecomics.com/solicitations/solicitations-for-dec-2026"
    }
  ]
};
