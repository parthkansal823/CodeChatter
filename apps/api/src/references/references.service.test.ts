import { BadGatewayException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { lookUpReference, type Fetcher } from "./references.service.js";

const BIBTEX = "@article{LeCun_2015, title={Deep learning}, year={2015}}";
const text = (body: string, status = 200) => new Response(body, { status });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const answering = (...answers: Response[]): Fetcher & ReturnType<typeof vi.fn> => {
  const fake = vi.fn();
  for (const answer of answers) fake.mockResolvedValueOnce(answer);
  return fake as unknown as Fetcher & ReturnType<typeof vi.fn>;
};

describe("looking up a reference", () => {
  it("asks doi.org for a DOI's BibTeX, following it to where it's kept", async () => {
    const fake = answering(redirect("https://api.crossref.org/v1/works/10.1038%2Fnature14539/transform"), text(`  ${BIBTEX}\n`));
    expect(await lookUpReference("https://doi.org/10.1038/nature14539", fake)).toBe(BIBTEX);
    expect(fake.mock.calls[0]![0]).toBe("https://doi.org/10.1038/nature14539");
    expect(fake.mock.calls[0]![1].headers.accept).toContain("application/x-bibtex");
    expect(fake.mock.calls[0]![1].redirect).toBe("manual");
    expect(fake.mock.calls[1]![0]).toContain("api.crossref.org");
  });

  it("asks arXiv for an arXiv id", async () => {
    const fake = answering(text("@misc{vaswani2017, title={Attention}}"));
    await lookUpReference("arXiv:1706.03762", fake);
    expect(fake.mock.calls[0]![0]).toBe("https://arxiv.org/bibtex/1706.03762");
  });

  it("makes no request for anything that isn't a DOI or arXiv id", async () => {
    const fake = answering();
    for (const input of ["http://169.254.169.254/latest/meta-data", "https://evil.example/10.1038/x", "hello"]) {
      await expect(lookUpReference(input, fake), input).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it("won't be redirected anywhere it doesn't know, or to plain http", async () => {
    for (const location of ["http://169.254.169.254/latest/meta-data", "https://evil.example/x", "http://api.crossref.org/x", "https://doi.org.evil.example/x", "file:///etc/passwd"]) {
      const fake = answering(redirect(location), text(BIBTEX));
      await expect(lookUpReference("10.1038/nature14539", fake), location).rejects.toBeInstanceOf(BadGatewayException);
      expect(fake, location).toHaveBeenCalledTimes(1);
    }
  });

  it("stops following after a few redirects", async () => {
    const fake = vi.fn(async () => redirect("https://doi.org/10.1000/again")) as unknown as Fetcher & ReturnType<typeof vi.fn>;
    await expect(lookUpReference("10.1038/nature14539", fake)).rejects.toThrow(/too many/);
    expect(fake.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("says so when nothing is found, or the service is down, or what comes back isn't a reference", async () => {
    await expect(lookUpReference("10.1038/nothing", answering(text("not found", 404)))).rejects.toThrow(/Nothing was found/);
    await expect(lookUpReference("10.1038/x", answering(text("oops", 500)))).rejects.toThrow(/didn't answer/);
    await expect(lookUpReference("10.1038/x", answering(text("<html>sign in</html>")))).rejects.toThrow(/wasn't a reference/);
    const failing = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as Fetcher;
    await expect(lookUpReference("10.1038/x", failing)).rejects.toThrow(/Couldn't reach/);
  });

  it("won't read an endless answer", async () => {
    await expect(lookUpReference("10.1038/x", answering(text(`@article{a, x={${"a".repeat(200 * 1024)}}}`)))).rejects.toThrow(/too long/);
  });
});
