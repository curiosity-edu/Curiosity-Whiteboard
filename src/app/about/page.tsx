import Link from "next/link";
import { Great_Vibes } from "next/font/google";

const greatVibes = Great_Vibes({ subsets: ["latin"], weight: "400" });

export default function AboutPage() {
  return (
    <div className="bg-white h-screen w-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 text-neutral-900 bg-white">
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 border border-neutral-300 rounded-md hover:bg-neutral-200"
            aria-label="Return to Whiteboard"
          >
            <span>←</span>
            <span>Return to Whiteboard</span>
          </Link>
        </div>
        <div className="relative min-h-[60px] mb-2">
          {/* Logo (optional) — place /public/textblack.png if available */}
          <img
            src="/textred.png"
            alt="Curiosity Education Logo"
            className="w-[250px] h-auto"
          />
        </div>

        <div className="text-sm text-neutral-500 mb-8">February 14, 2025</div>

        <div className="max-w-none">
          <h1 className="text-2xl font-semibold mb-4">
            Humanity’s Progress Has Stemmed from One Thing: Curiosity.
          </h1>
          <div className="space-y-4 leading-7">
            <p>
              From deploying the internet to sending rovers to Mars—every
              innovation has only ever existed because its creator was naturally
              curious about something. Curiosity pushes us to ask questions,
              explore, and challenge the boundaries of what we know.
            </p>
            <p>
              Yet, this same curiosity often withers within the confines of
              modern education. Education, at its core, is the process of
              transforming raw information into deep, intuitive understanding.
              And once that understanding takes root, curiosity takes over to
              drive exploration & innovation. However, the traditional education
              system relies on lecture-based learning, which has consistently
              fallen short of covering the four components of true education:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>What is it?</strong> (The formal definition)
              </li>
              <li>
                <strong>Where does it come from?</strong> (The intuition)
              </li>
              <li>
                <strong>How do I use it?</strong> (Problem-solving and practical
                application)
              </li>
              <li>
                <strong>So what?</strong> (Its relevance to careers, research,
                and the real world)
              </li>
            </ul>
            <p>
              To bridge these gaps, students often turn to external resources.
              But existing platforms, while valuable, remain fundamentally
              incomplete. Videos like those from 3Blue1Brown offer rich
              conceptual explanations and broader applications but fail to show
              how concepts translate into problem-solving. Conversely, platforms
              like Khan Academy and Organic Chemistry Tutor excel at procedural
              learning but lack the deeper intuition and relevance needed to
              make knowledge truly stick.
            </p>
            <p>
              And then there’s the problem of scope. These resources are
              inherently limited. If a student wants to explore a niche
              topic—perhaps the geometric intuition behind eigenvectors or the
              role of differential equations in neuroscience—they're at the
              mercy of whatever content/style of explanation happens to exist.
            </p>
            <p>
              Now you might be wondering, how do we know all of this? Well,
              we’re students! We’ve spent years navigating these exact
              challenges ourselves. And now we’re here to bridge this gap for
              the next generation of learners— with Curiosity Education, an
              AI-powered learning platform that actually teaches math.
            </p>
            <p>Much more to come,</p>
            <p className="mt-8">Sincerely,</p>
            <p className={`${greatVibes.className} text-3xl leading-tight`}>
              Advaith Vijayakumar
              <br />
              Shlok Rathi
              <br />
              Vishal Yalla
            </p>
            <p>The Curiosity-edu Team</p>
          </div>
        </div>

        <div className="mt-10 grid gap-2">
          <a
            href="https://docs.google.com/document/d/1agvnLe0dD8wDqHdlyIPjqCoD_PP5oLBda7ixQpgTk6g/edit?"
            className="inline-block px-3 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 border border-neutral-300 rounded-md hover:bg-neutral-200"
            target="_blank"
            rel="noreferrer"
          >
            🚀 Read our full manifesto
          </a>
          <a
            href="https://www.linkedin.com/company/curiosity-edu/"
            className="inline-block px-3 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 border border-neutral-300 rounded-md hover:bg-neutral-200"
            target="_blank"
            rel="noreferrer"
          >
            🔗 Connect with us on LinkedIn
          </a>
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSdG3w-inm_3NtorMgCf2GePSH5M2D8sK5hSQPqt7scj0Zxo4Q/viewform"
            className="inline-block px-3 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 border border-neutral-300 rounded-md hover:bg-neutral-200"
            target="_blank"
            rel="noreferrer"
          >
            📝 Fill out our Interest Form
          </a>
          <a
            href="mailto:team@curiosity-edu.org"
            className="inline-block px-3 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 border border-neutral-300 rounded-md hover:bg-neutral-200"
          >
            📧 Contact us at team@curiosity-edu.org
          </a>
        </div>
      </div>
    </div>
  );
}
