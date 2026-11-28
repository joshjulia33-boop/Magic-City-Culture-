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
  updatedAt: "2026-11-28T05:03:02Z",
  sourceNote: "Release dates and details from publisher solicitations and announcements (DC, Marvel, Image, IDW), Previews listings and comic news. Dates can shift — each slide links to its source.",
  items: [
    {
      rank: 1,
      title: "Maximum X-Men",
      issue: "#1 (Marvel, 2026)",
      publisher: "Marvel",
      releaseDate: "2026-12-02",
      dateLabel: "Releases Dec 2, 2026",
      whyHot: "Out this Wednesday: Christopher Yost & Tony S. Daniel — with the Avengers gone after Armageddon, Storm and Wolverine assemble Earth's Mightiest Mutants. AIPT previewed it Nov 27.",
      coverUrl: "https://images.penguinrandomhouse.com/cover/d/75960621728100111",
      link: "https://www.marvel.com/comics/issue/138421/maximum_x-men_2026_1"
    },
    {
      rank: 2,
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
      rank: 3,
      title: "Chainkata",
      issue: "#2 (Image, 2026)",
      publisher: "Image",
      releaseDate: "2026-12-23",
      dateLabel: "Releases Dec 23, 2026",
      whyHot: "The follow-up to the year's biggest launch — #1 sold out its 250K+ first print at the distributor, and the Ito Gotham Central virgin (limited 500) already sold at $119 pre-release per CovrPrice. #1 second printing lands the same day.",
      coverUrl: null,
      link: "https://imagecomics.com/press-releases/chainkata-the-biggest-launch-of-the-year-sold-out-ahead-of-this-weeks-launch-rushed-back-to-print"
    },
    {
      rank: 4,
      title: "Creature Corps",
      issue: "#1 (Image, 2026)",
      publisher: "Image",
      releaseDate: "2026-12-02",
      dateLabel: "Releases Dec 2, 2026",
      whyHot: "New entry: Curt Pires & Jok's giant-sized 64-page series premiere lands Dec 2 with a companion trading-card game, a polybagged secret-cover Booster Bundle, and Tyler Kirkham and Jae Lee variants — named a Top 5 new key comic for Dec 2 by InvestComics.",
      coverUrl: null,
      link: "https://imagecomics.com/solicitations/solicitations-for-dec-2026"
    },
    {
      rank: 5,
      title: "Venom: P.O.V.",
      issue: "#1 (Marvel, 2026)",
      publisher: "Marvel",
      releaseDate: "2026-12-02",
      dateLabel: "Releases Dec 2, 2026",
      whyHot: "New entry: Ryan Stegman & Carlos Gómez retell Venom's origin from the symbiote's point of view — a five-issue launch Dec 2 with a 1:25 and a virgin 1:50 variant, previewed by AIPT on Nov 27.",
      coverUrl: null,
      link: "https://aiptcomics.com/2026/11/27/marvel-preview-venom-pov-1/"
    },
    {
      rank: 6,
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
      rank: 7,
      title: "Fugitive X-Force",
      issue: "#1 (Marvel, 2026)",
      publisher: "Marvel",
      releaseDate: "2026-12-09",
      dateLabel: "Releases Dec 9, 2026",
      whyHot: "New entry: Tim Seeley & Áthila Fabbio relaunch X-Force with Boom-Boom leading the team for the first time, framed and on the run — Eric Canete covers up to a virgin 1:100.",
      coverUrl: null,
      link: "https://bleedingcool.com/comics/marvel-comics-official-full-december-2026-solicits-and-solicitations/"
    },
    {
      rank: 8,
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
      rank: 9,
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
      rank: 10,
      title: "Batman",
      issue: "#17 (DC, 2027)",
      publisher: "DC",
      releaseDate: "2027-01-06",
      dateLabel: "Releases Jan 6, 2027",
      whyHot: "Matt Fraction & Jorge Jiménez: after Bruce Wayne's “death,” Batman debuts two new identities — one already revealed: Phantom Lord.",
      coverUrl: "https://bleedingcool.com/wp-content/uploads/2026/11/large-5881180.jpg",
      link: "https://www.keycollectorcomics.com/issue/batman-1-17-1,935124/"
    }
  ]
};
