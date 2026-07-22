"use client";

import { useState, useRef, useEffect, useCallback, DragEvent, ChangeEvent } from "react";
import JSZip from "jszip";
import { UploadCloud, File, Trash2, Settings, ChevronDown, CheckCircle2, AlertCircle, Loader2, RefreshCw, RotateCcw, Layers3, ArrowRight, X } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatNumber(value: number | string) {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

function formatBoxId(value: number | string) {
  return String(value);
}

function isSameCoordinates(
  a: { xtl: number; ytl: number; xbr: number; ybr: number },
  b: { xtl: number; ytl: number; xbr: number; ybr: number },
  epsilon = 1e-6
) {
  return (
    Math.abs(a.xtl - b.xtl) <= epsilon &&
    Math.abs(a.ytl - b.ytl) <= epsilon &&
    Math.abs(a.xbr - b.xbr) <= epsilon &&
    Math.abs(a.ybr - b.ybr) <= epsilon
  );
}

interface ImageInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  labelCounts: Record<string, number>;
  boxLabels: string[];
  boxIds: (number | null)[];
  boxCoords: ({ xtl: number; ytl: number; xbr: number; ybr: number } | null)[];
  totalBoxes: number;
  exclBoxes: number;
  frameSkipBoxCount: number;
  frameNoBox: number;
  hasPass: boolean;
}

interface JobInfo {
  id: number;
  start: number;
  stop: number;
  url: string;
}

interface XmlData {
  minFrame: number;
  maxFrame: number;
  labelHasAttributes: Record<string, boolean>;
  images: ImageInfo[];
  jobs: JobInfo[];
}

interface DuplicatePairDetail {
  frameId: number;
  boxIdA: number | string;
  boxIdB: number | string;
  labelA: string;
  labelB: string;
  coords?: { xtl: number; ytl: number; xbr: number; ybr: number };
  width?: number;
  height?: number;
}



export default function BoxCounterPage() {
  const [currentXmlData, setCurrentXmlData] = useState<XmlData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [dragover, setDragover] = useState(false);

  const [startFrame, setStartFrame] = useState<number | "">(0);
  const [endFrame, setEndFrame] = useState<number | "">(0);
  const [excludeLabels, setExcludeLabels] = useState<string[]>(["_corrupt"]);
  const [showExcludePanel, setShowExcludePanel] = useState(false);
  const [newExcludeLabel, setNewExcludeLabel] = useState("");

  const [results, setResults] = useState<{
    excludeCount: number;
    totalBoxesCount: number;
    totalAfterExclude: number;
    framesWithSkipCount: number;
    framesWithBoxesCount: number;
    firstBoxId: number | string;
    lastBoxId: number | string;
    totalFrames: number;
    duplicateCount: number;
  } | null>(null);

  const [duplicateDetails, setDuplicateDetails] = useState<DuplicatePairDetail[]>([]);
  const [isOpenDuplicateModal, setIsOpenDuplicateModal] = useState(false);

  const handleOpenDuplicateModal = () => {
    setIsOpenDuplicateModal(true);
  };

  const handleCloseDuplicateModal = () => {
    setIsOpenDuplicateModal(false);
  };

  const getBoxPosition = (coords: { xtl: number; ytl: number; xbr: number; ybr: number }, width?: number, height?: number): string => {
    const centerX = (coords.xtl + coords.xbr) / 2;
    const centerY = (coords.ytl + coords.ybr) / 2;
    
    let posX = "";
    let posY = "";
    
    if (width) {
      const ratioX = centerX / width;
      if (ratioX < 0.2) posX = "Trái";
      else if (ratioX < 0.4) posX = "Gần trái";
      else if (ratioX < 0.6) posX = "Giữa";
      else if (ratioX < 0.8) posX = "Gần phải";
      else posX = "Phải";
    }
    
    if (height) {
      const ratioY = centerY / height;
      if (ratioY < 0.2) posY = "Trên";
      else if (ratioY < 0.4) posY = "Gần trên";
      else if (ratioY < 0.6) posY = "Giữa";
      else if (ratioY < 0.8) posY = "Gần dưới";
      else posY = "Dưới";
    }
    
    if (posX && posY) {
      if (posX === "Giữa" && posY === "Giữa") return "Trung tâm";
      if (posX === "Giữa") return posY;
      if (posY === "Giữa") return posX;
      return `${posX} - ${posY}`;
    }
    
    return posX || posY || "Trung tâm";
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("excludeLabels");
      if (raw) {
        setExcludeLabels(JSON.parse(raw));
      }
    } catch { }
  }, []);

  const saveExcludeLabels = (labels: string[]) => {
    setExcludeLabels(labels);
    try {
      localStorage.setItem("excludeLabels", JSON.stringify(labels));
    } catch { }
  };

  const handleAddExclude = () => {
    const val = newExcludeLabel.trim();
    if (val && !excludeLabels.includes(val)) {
      saveExcludeLabels([...excludeLabels, val]);
    }
    setNewExcludeLabel("");
  };

  const handleRemoveExclude = (label: string) => {
    saveExcludeLabels(excludeLabels.filter((l) => l !== label));
  };

  const isAttrSelected = (val: string | number | null) => {
    if (!val && val !== 0) return false;
    const t = String(val).trim().toLowerCase();
    return t === "true" || t === "1" || t === "yes" || t === "y" || t === "on";
  };

  const parseXmlContentToData = (xmlContent: string): XmlData => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "text/xml");

    if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
      throw new Error("Invalid XML file format.");
    }

    const images = xmlDoc.getElementsByTagName("image");
    if (images.length === 0) {
      throw new Error("No image tags found in the XML.");
    }

    const jobs: JobInfo[] = [];
    const segments = xmlDoc.getElementsByTagName("segment");
    Array.from(segments).forEach(seg => {
      const idEl = seg.getElementsByTagName("id")[0];
      const startEl = seg.getElementsByTagName("start")[0];
      const stopEl = seg.getElementsByTagName("stop")[0];
      const urlEl = seg.getElementsByTagName("url")[0];
      if (idEl && startEl && stopEl && urlEl) {
        jobs.push({
          id: parseInt(idEl.textContent || "0", 10),
          start: parseInt(startEl.textContent || "0", 10),
          stop: parseInt(stopEl.textContent || "0", 10),
          url: urlEl.textContent || ""
        });
      }
    });

    const labelDefs = Array.from(xmlDoc.getElementsByTagName("label"));
    const labelHasAttributes: Record<string, boolean> = {};
    const labelAttrNames: Record<string, string[]> = {};

    labelDefs.forEach((ld) => {
      let name = "";
      const nameEl = ld.getElementsByTagName("name")[0];
      if (nameEl) name = String(nameEl.textContent || "").trim();
      if (!name) name = ld.getAttribute("name") || "";

      const attrEls = Array.from(ld.getElementsByTagName("attribute"));
      labelHasAttributes[name] = attrEls.length > 0;

      const attrNames: string[] = [];
      attrEls.forEach((ae) => {
        let aName = "";
        const aNameEl = ae.getElementsByTagName("name")[0];
        if (aNameEl) aName = String(aNameEl.textContent || "").trim();
        if (!aName) aName = ae.getAttribute("name") || "";
        if (aName) attrNames.push(aName);
      });
      labelAttrNames[name] = attrNames;
    });

    const allBoxes = Array.from(xmlDoc.getElementsByTagName("box"));
    allBoxes.forEach((b, idx) => {
      if (!b.getAttribute("id")) {
        b.setAttribute("id", String(idx + 1));
      }
    });

    const parsedImages: ImageInfo[] = Array.from(images).map((img, imgIdx) => {
      const boxes = Array.from(img.getElementsByTagName("box"));

      const boxIds = boxes.map((b) => {
        const bid = b.getAttribute("id");
        if (bid === null || bid === undefined) return null;
        const parsed = parseInt(bid, 10);
        return Number.isNaN(parsed) ? null : parsed;
      });

      const boxCoords = boxes.map((b) => {
        const xtl = parseFloat(b.getAttribute("xtl") || "");
        const ytl = parseFloat(b.getAttribute("ytl") || "");
        const xbr = parseFloat(b.getAttribute("xbr") || "");
        const ybr = parseFloat(b.getAttribute("ybr") || "");

        if ([xtl, ytl, xbr, ybr].some((n) => Number.isNaN(n))) {
          return null;
        }

        return { xtl, ytl, xbr, ybr };
      });

      const boxLabels = boxes.map((b) =>
        String(b.getAttribute("label") || b.getAttribute("label_name") || b.getAttribute("name") || "").trim()
      );

      const boxAttributesArray = boxes.map((b) =>
        Array.from(b.getElementsByTagName("attribute")).map((a) => String(a.textContent || "").trim())
      );

      const counts: Record<string, number> = {};
      let frameSkipBoxCount = 0;
      let hasPass = false;

      boxes.forEach((b, idx) => {
        const lbl = String(boxLabels[idx] || "").trim();
        if (!lbl) return;
        counts[lbl] = (counts[lbl] || 0) + 1;

        if (lbl.toLowerCase().includes("skip")) {
          frameSkipBoxCount++;
        }

        const attrNames = labelAttrNames[lbl] || [];
        const passIdx = attrNames.findIndex((n) => String(n || "").trim().toLowerCase() === "pass");
        if (passIdx >= 0 && boxAttributesArray[idx]) {
          const passValue = boxAttributesArray[idx][passIdx];
          if (passValue && isAttrSelected(passValue)) {
            hasPass = true;
          }
        }
      });

      return {
        id: parseInt(img.getAttribute("id") || String(imgIdx), 10),
        name: img.getAttribute("name") || "",
        width: parseFloat(img.getAttribute("width") || "0"),
        height: parseFloat(img.getAttribute("height") || "0"),
        labelCounts: counts,
        boxLabels,
        boxIds: boxIds,
        boxCoords,
        totalBoxes: boxes.length,
        exclBoxes: boxLabels.filter((l) => String(l).toLowerCase() === "_excl_area").length,
        frameSkipBoxCount,
        frameNoBox: boxes.length === 0 ? 1 : 0,
        hasPass,
      };
    });

    const ids = parsedImages.map((img) => img.id).filter((x) => !isNaN(x));
    const minFrame = ids.length ? Math.min(...ids) : 0;
    const maxFrame = ids.length ? Math.max(...ids) : 0;

    return {
      labelHasAttributes,
      images: parsedImages,
      minFrame,
      maxFrame,
      jobs,
    };
  };

  const parseXML = (xmlContent: string) => {
    const data = parseXmlContentToData(xmlContent);
    setCurrentXmlData(data);
    setStartFrame(data.minFrame);
    setEndFrame(data.maxFrame);
    setResults(null);
    setError(null);
  };

  const handleFileProcess = (file: File) => {
    setLoading(true);
    setError(null);

    const name = file.name.toLowerCase();
    const completeWithXml = (content: string) => {
      parseXML(content);
      setFileName(file.name);
    };

    if (name.endsWith(".xml")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          completeWithXml(e.target?.result as string);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : "Failed to process XML file.");
        } finally {
          setLoading(false);
        }
      };
      reader.onerror = () => {
        setError("Failed to read the XML file.");
        setLoading(false);
      };
      reader.readAsText(file);
    } else if (name.endsWith(".zip")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        JSZip.loadAsync(e.target?.result as ArrayBuffer)
          .then((zip) => {
            const xmlFiles = zip.file(/\.xml$/i) || [];
            if (xmlFiles.length === 0) {
              throw new Error("No XML file found in the ZIP archive.");
            }

            const preferredFile = xmlFiles.find((zipFile) => /annotations\.xml$/i.test(zipFile.name)) || xmlFiles[0];
            return preferredFile.async("text").then(completeWithXml);
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : "Unknown ZIP error.";
            setError("Error extracting ZIP: " + message);
          })
          .finally(() => setLoading(false));
      };
      reader.onerror = () => {
        setError("Failed to read the ZIP file.");
        setLoading(false);
      };
      reader.readAsArrayBuffer(file);
    } else {
      setError("Please select an .xml or .zip file.");
      setLoading(false);
    }
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      handleFileProcess(file);
    }
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragover(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const handleClearData = () => {
    setFileName("");
    setCurrentXmlData(null);
    setResults(null);
    setDuplicateDetails([]);
    setError(null);
    setIsOpenDuplicateModal(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const resetFrameRange = () => {
    if (!currentXmlData) return;
    setStartFrame(currentXmlData.minFrame);
    setEndFrame(currentXmlData.maxFrame);
  };

  const calculateRange = useCallback(() => {
    if (!currentXmlData) {
      setError("No file loaded");
      return;
    }

    const sVal = typeof startFrame === "number" ? startFrame : currentXmlData.minFrame;
    const eVal = typeof endFrame === "number" ? endFrame : currentXmlData.maxFrame;

    // Computational clamping for live stats without overriding user's typing state
    const clampedStart = Math.max(currentXmlData.minFrame, Math.min(sVal, currentXmlData.maxFrame));
    const clampedEnd = Math.max(clampedStart, Math.min(eVal, currentXmlData.maxFrame));

    setError(null);
    const filteredImages = currentXmlData.images.filter((img) => img.id >= clampedStart && img.id <= clampedEnd);

    const excludeCount = filteredImages.reduce((sum, img) => sum + img.exclBoxes, 0);
    const excludeSet = new Set(excludeLabels.map((x) => x.toLowerCase()));
    const extraExcludeCount = filteredImages.reduce((sum, img) => {
      let s = 0;
      img.boxLabels.forEach((l) => {
        if (l && excludeSet.has(l.toLowerCase())) s++;
      });
      return sum + s;
    }, 0);

    const skipFrameBoxesCount = filteredImages.reduce((sum, img) => {
      if (img.hasPass) return sum + img.totalBoxes;
      return sum + img.frameSkipBoxCount;
    }, 0);

    const combinedExcludeCount = excludeCount + extraExcludeCount + skipFrameBoxesCount;
    const totalBoxesCount = filteredImages.reduce((sum, img) => sum + img.totalBoxes, 0);
    const totalBoxesAfterExcludeRange = Math.max(0, totalBoxesCount - combinedExcludeCount);

    const framesWithSkipCount = filteredImages.reduce((sum, img) => {
      const hasSkip = img.totalBoxes === 0 || img.boxLabels.some((l) => l.toLowerCase().includes("skip")) || img.hasPass;
      return sum + (hasSkip ? 1 : 0);
    }, 0);
    const framesWithBoxesCount = filteredImages.reduce((sum, img) => sum + (img.totalBoxes > 0 ? 1 : 0), 0);

    const allBoxIds = filteredImages.flatMap((f) => f.boxIds).filter((x) => x !== null) as number[];
    const firstBoxId = allBoxIds.length > 0 ? allBoxIds.reduce((min, id) => (id < min ? id : min), allBoxIds[0]) : "—";
    const lastBoxId = allBoxIds.length > 0 ? allBoxIds.reduce((max, id) => (id > max ? id : max), allBoxIds[0]) : "—";

    let duplicateCount = 0;
    const duplicatePairs: DuplicatePairDetail[] = [];
    const seenSameLabelGroups = new Set<string>();

    filteredImages.forEach((img) => {
      const validBoxes = img.boxCoords
        .map((coord, idx) => {
          if (!coord) return null;
          return { coord, idx };
        })
        .filter((x): x is { coord: { xtl: number; ytl: number; xbr: number; ybr: number }; idx: number } => x !== null);

      for (let i = 0; i < validBoxes.length; i++) {
        for (let j = i + 1; j < validBoxes.length; j++) {
          const first = validBoxes[i].coord;
          const second = validBoxes[j].coord;

          const firstIdx = validBoxes[i].idx;
          const secondIdx = validBoxes[j].idx;
          const boxIdA = img.boxIds[firstIdx] ?? `index:${firstIdx + 1}`;
          const boxIdB = img.boxIds[secondIdx] ?? `index:${secondIdx + 1}`;
          const labelA = img.boxLabels[firstIdx] || "unknown";
          const labelB = img.boxLabels[secondIdx] || "unknown";

          if (!isSameCoordinates(first, second)) continue;

          if (labelA === labelB) {
            const groupKey = `${img.id}|${labelA}|${first.xtl}|${first.ytl}|${first.xbr}|${first.ybr}`;
            if (seenSameLabelGroups.has(groupKey)) continue;
            seenSameLabelGroups.add(groupKey);
          }

          duplicateCount++;
          duplicatePairs.push({
            frameId: img.id,
            boxIdA,
            boxIdB,
            labelA,
            labelB,
            coords: first,
            width: img.width,
            height: img.height,
          });
        }
      }
    });

    setResults({
      excludeCount: combinedExcludeCount,
      totalBoxesCount,
      totalAfterExclude: totalBoxesAfterExcludeRange,
      framesWithSkipCount,
      framesWithBoxesCount,
      firstBoxId,
      lastBoxId,
      totalFrames: filteredImages.length, // Only frames in range
      duplicateCount,
    });
    setDuplicateDetails(duplicatePairs);
  }, [currentXmlData, startFrame, endFrame, excludeLabels]);

  useEffect(() => {
    if (currentXmlData) {
      calculateRange();
    }
  }, [currentXmlData, calculateRange]);

  const availableFrameCount = currentXmlData?.images.length ?? 0;
  const fileBoxCount = currentXmlData?.images.reduce((sum, image) => sum + image.totalBoxes, 0) ?? 0;
  const rangeStart = currentXmlData
    ? Math.max(currentXmlData.minFrame, Math.min(typeof startFrame === "number" ? startFrame : currentXmlData.minFrame, currentXmlData.maxFrame))
    : 0;
  const rangeEnd = currentXmlData
    ? Math.max(rangeStart, Math.min(typeof endFrame === "number" ? endFrame : currentXmlData.maxFrame, currentXmlData.maxFrame))
    : 0;
  const selectedFrameCount = results?.totalFrames ?? 0;
  const selectedRangePercent = availableFrameCount > 0 ? Math.min(100, (selectedFrameCount / availableFrameCount) * 100) : 0;
  const primaryJob = currentXmlData?.jobs[0];
  const remainingJobCount = Math.max(0, (currentXmlData?.jobs.length ?? 0) - 1);
  const allJobIds = currentXmlData?.jobs.map((job) => `#${job.id}`).join(", ") ?? "";
  const isFullRange = Boolean(
    currentXmlData && rangeStart === currentXmlData.minFrame && rangeEnd === currentXmlData.maxFrame
  );

  return (
    <div className="relative min-h-screen overflow-x-hidden px-4 py-8 transition-colors duration-500 sm:px-6 sm:py-12 lg:py-16">
      <div className="relative z-10 mx-auto w-full max-w-6xl">
        <div className="pointer-events-none absolute -left-24 -top-24 h-56 w-56 rounded-full bg-blue-600 opacity-30 blur-[120px] sm:-left-32 sm:-top-32 sm:h-72 sm:w-72" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-56 w-56 rounded-full bg-purple-600 opacity-30 blur-[120px] sm:-bottom-32 sm:-right-32 sm:h-72 sm:w-72" />

        <main className="glass-panel relative z-10 min-w-0 rounded-2xl p-5 shadow-2xl transition-all duration-300 sm:p-8 lg:p-10">
          <header className="mb-7 mt-1 text-center sm:mb-8">
            <h1 className="flex flex-wrap items-center justify-center gap-x-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
              <span className="text-gradient">Annotations</span>
              <span className="text-gradient-accent">Counter</span>
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm font-medium leading-6 tracking-wide text-secondary">
              Advanced tool to count items and filtered statistics from CVAT labels.
            </p>
          </header>

          <input
            type="file"
            ref={fileInputRef}
            accept=".xml,.zip"
            className="hidden"
            aria-label="Upload annotation file"
            onChange={onFileChange}
          />

          {!fileName && !currentXmlData && !loading && (
            <button
              type="button"
              className={cn(
                "group w-full rounded-xl border-2 border-dashed p-8 text-center transition-all duration-300 sm:p-10",
                dragover
                  ? "border-blue-400 bg-blue-500/5 shadow-[0_0_30px_rgba(59,130,246,0.15)]"
                  : "border-white/10 hover:border-white/20 hover:bg-white/5"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragover(true);
              }}
              onDragLeave={() => setDragover(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/5 transition-all group-hover:scale-105 group-hover:bg-blue-500/10">
                <UploadCloud className={cn("h-8 w-8", dragover ? "text-blue-400" : "text-zinc-400")} />
              </span>
              <span className="block text-lg font-semibold text-white">Upload file</span>
              <span className="mt-2 block text-sm leading-6 text-secondary">
                kéo thả file <code className="text-white">.xml</code> hoặc <code className="text-white">.zip</code> chứa annotations
              </span>
            </button>
          )}

          {error && (
            <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div className="min-w-0">
                <div className="mb-1 font-semibold text-red-300">Error Parsing Data</div>
                <p className="break-words">{error}</p>
              </div>
            </div>
          )}

          {loading && !currentXmlData && (
            <div className="flex items-center justify-center gap-3 py-12 text-zinc-400">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              <span className="font-medium tracking-wide">Processing your file...</span>
            </div>
          )}

          {currentXmlData && (
            <div className="min-w-0 space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <section className="glass-panel rounded-xl border border-white/5 p-4 sm:p-5">
                <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-400/15 bg-blue-500/10">
                      <File className="h-4 w-4 text-blue-400" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary">Information</h2>
                      <div className="mt-1 truncate text-sm font-semibold text-white/90" title={fileName || "Processed file"}>
                        {fileName || "Processed file"}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-secondary">
                        {loading ? (
                          <span className="flex items-center gap-1.5 text-blue-300">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Processing new file...
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-green-300/90">
                            <CheckCircle2 className="h-3 w-3" />
                            Processed successfully
                          </span>
                        )}
                        <span className="hidden h-1 w-1 rounded-full bg-white/20 sm:block" />
                        <span>{formatNumber(availableFrameCount)} frames</span>
                        <span className="h-1 w-1 rounded-full bg-white/20" />
                        <span>{formatNumber(fileBoxCount)} boxes</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
                    {primaryJob && (
                      <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-secondary">
                        Job ID <span className="font-mono font-bold text-white">#{primaryJob.id}</span>
                      </span>
                    )}
                    {remainingJobCount > 0 && (
                      <span
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75"
                        title={`Jobs: ${allJobIds}`}
                      >
                        +{remainingJobCount} jobs
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Change file
                    </button>
                    <button
                      type="button"
                      onClick={handleClearData}
                      disabled={loading}
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-400/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Xóa dữ liệu
                    </button>
                  </div>
                </div>
              </section>

              <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
                <aside className="min-w-0 space-y-4 lg:col-span-4">
                  <section className="glass-panel rounded-xl border border-white/5 p-4 sm:p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-secondary">Frame Range</h2>
                      <button
                        type="button"
                        onClick={resetFrameRange}
                        disabled={isFullRange}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-blue-300 transition-colors hover:bg-blue-500/10 disabled:cursor-default disabled:text-zinc-600 disabled:hover:bg-transparent"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="min-w-0">
                        <span className="mb-1.5 block text-xs text-secondary/70">Start</span>
                        <span className="block rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 transition-colors focus-within:border-blue-500/70 focus-within:bg-blue-500/[0.03]">
                          <input
                            type="number"
                            autoComplete="off"
                            aria-label="Start frame"
                            value={startFrame}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setStartFrame(isNaN(val) ? "" : val);
                            }}
                            onBlur={() => {
                              if (!currentXmlData) return;
                              if (
                                startFrame === "" ||
                                (typeof startFrame === "number" && (startFrame < currentXmlData.minFrame || startFrame > currentXmlData.maxFrame))
                              ) {
                                setStartFrame(currentXmlData.minFrame);
                              } else if (typeof startFrame === "number" && typeof endFrame === "number" && startFrame > endFrame) {
                                setStartFrame(endFrame);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            className="w-full min-w-0 bg-transparent text-lg font-bold text-white outline-none"
                          />
                        </span>
                      </label>

                      <label className="min-w-0">
                        <span className="mb-1.5 block text-xs text-secondary/70">End</span>
                        <span className="block rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 transition-colors focus-within:border-blue-500/70 focus-within:bg-blue-500/[0.03]">
                          <input
                            type="number"
                            autoComplete="off"
                            aria-label="End frame"
                            value={endFrame}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setEndFrame(isNaN(val) ? "" : val);
                            }}
                            onBlur={() => {
                              if (!currentXmlData) return;
                              if (
                                endFrame === "" ||
                                (typeof endFrame === "number" && (endFrame < currentXmlData.minFrame || endFrame > currentXmlData.maxFrame))
                              ) {
                                setEndFrame(currentXmlData.maxFrame);
                              } else if (typeof endFrame === "number" && typeof startFrame === "number" && endFrame < startFrame) {
                                setEndFrame(startFrame);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            className="w-full min-w-0 bg-transparent text-lg font-bold text-white outline-none"
                          />
                        </span>
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-1 text-[11px] text-secondary/70">
                      <span>Available: {formatNumber(currentXmlData.minFrame)}–{formatNumber(currentXmlData.maxFrame)}</span>
                      <span className="font-medium text-white/60">{formatNumber(selectedFrameCount)} selected</span>
                    </div>
                  </section>

                  <section className="glass-panel overflow-hidden rounded-xl border border-white/5">
                    <button
                      type="button"
                      onClick={() => setShowExcludePanel(!showExcludePanel)}
                      className="flex min-h-14 w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-white/5"
                      aria-expanded={showExcludePanel}
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white">
                        <Settings className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span className="truncate">Exclude Config</span>
                        <span className="shrink-0 rounded-full border border-blue-400/15 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                          {excludeLabels.length} active
                        </span>
                      </span>
                      <ChevronDown className={cn("h-4 w-4 shrink-0 text-zinc-400 transition-transform", showExcludePanel && "rotate-180")} />
                    </button>

                    {showExcludePanel && (
                      <div className="border-t border-white/5 px-4 pb-4 pt-3 animate-in fade-in slide-in-from-top-2">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <p className="text-xs leading-5 text-secondary">Labels added here will be excluded from the final target count.</p>
                          {excludeLabels.length > 0 && (
                            <button
                              type="button"
                              onClick={() => saveExcludeLabels([])}
                              className="shrink-0 text-[11px] font-semibold text-zinc-400 transition-colors hover:text-white"
                            >
                              Clear all
                            </button>
                          )}
                        </div>
                        <div className="mb-3 flex min-w-0 gap-2">
                          <input
                            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white transition-colors placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                            type="text"
                            placeholder="e.g. _corrupt"
                            value={newExcludeLabel}
                            onChange={(e) => setNewExcludeLabel(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddExclude()}
                          />
                          <button
                            type="button"
                            disabled={!newExcludeLabel.trim()}
                            className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
                            onClick={handleAddExclude}
                          >
                            Add
                          </button>
                        </div>
                        <div className="flex min-w-0 flex-wrap gap-2">
                          {excludeLabels.length > 0 ? excludeLabels.map((label) => (
                            <span
                              key={label}
                              className="group flex max-w-full items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/10"
                            >
                              <span className="truncate">{label}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveExclude(label)}
                                className="shrink-0 text-zinc-500 transition-colors hover:text-white"
                                aria-label={`Remove ${label}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          )) : (
                            <span className="text-xs text-zinc-600">No excluded labels.</span>
                          )}
                        </div>
                      </div>
                    )}
                  </section>

                  <section className="glass-panel rounded-xl border border-white/5 p-4 sm:p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Layers3 className="h-4 w-4 text-blue-400" />
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-secondary">Range Summary</h2>
                      </div>
                      <span className="font-mono text-[11px] text-white/50">{rangeStart}–{rangeEnd}</span>
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-secondary">Selected Frames</span>
                        <span className="font-bold text-white">{formatNumber(selectedFrameCount)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-secondary">Frames with Boxes</span>
                        <span className="font-bold text-blue-300">{formatNumber(results?.framesWithBoxesCount ?? 0)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-secondary">Skipped / Passed</span>
                        <span className="font-bold text-amber-300">{formatNumber(results?.framesWithSkipCount ?? 0)}</span>
                      </div>
                    </div>

                    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-[width] duration-300"
                        style={{ width: `${selectedRangePercent}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-secondary/60">
                      {selectedRangePercent.toFixed(selectedRangePercent >= 10 ? 0 : 1)}% of available frames selected
                    </p>
                  </section>
                </aside>

                <section className="min-w-0 lg:col-span-8">
                  {results ? (
                    <div className="glass-panel relative overflow-hidden rounded-2xl border border-white/10">
                      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-purple-500" />
                      <div className="p-5 sm:p-6 lg:p-7">
                        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                          <h2 className="text-lg font-bold text-white">Statistic Overview</h2>
                          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary">
                            Live result
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-[minmax(0,1.85fr)_repeat(4,minmax(0,1fr))]">
                          <div className="relative col-span-2 overflow-hidden rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] p-3 xl:col-span-1">
                            <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-emerald-400/10 blur-2xl" />
                            <div className="relative">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200/70">Final Count</div>
                              <div className="mt-2 whitespace-nowrap text-[2rem] font-black tabular-nums tracking-tight text-emerald-300">
                                {formatNumber(results.totalAfterExclude)}
                              </div>
                            </div>
                          </div>

                          <div className="min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
                            <div className="min-h-7 text-[9px] font-semibold uppercase leading-4 tracking-[0.08em] text-secondary">Included Frames</div>
                            <div className="mt-2 whitespace-nowrap text-lg font-extrabold tabular-nums tracking-tight text-white 2xl:text-xl" title={String(results.totalFrames)}>
                              {formatNumber(results.totalFrames)}
                            </div>
                          </div>

                          <div className="min-w-0 rounded-xl border border-blue-400/10 bg-blue-400/[0.04] p-3">
                            <div className="min-h-7 text-[9px] font-semibold uppercase leading-4 tracking-[0.08em] text-secondary">Total Boxes</div>
                            <div className="mt-2 whitespace-nowrap text-lg font-extrabold tabular-nums tracking-tight text-blue-400 2xl:text-xl" title={String(results.totalBoxesCount)}>
                              {formatNumber(results.totalBoxesCount)}
                            </div>
                          </div>

                          <div className="min-w-0 rounded-xl border border-purple-400/10 bg-purple-400/[0.04] p-3">
                            <div className="min-h-7 text-[9px] font-semibold uppercase leading-4 tracking-[0.08em] text-secondary">Excluded</div>
                            <div className="mt-2 whitespace-nowrap text-lg font-extrabold tabular-nums tracking-tight text-purple-400 2xl:text-xl" title={String(results.excludeCount)}>
                              {formatNumber(results.excludeCount)}
                            </div>
                          </div>

                          <div className="min-w-0 rounded-xl border border-amber-400/15 bg-amber-400/[0.06] p-3">
                            <div className="min-h-7 text-[9px] font-semibold uppercase leading-4 tracking-[0.08em] text-secondary">Frame Skip</div>
                            <div className="mt-2 whitespace-nowrap text-lg font-extrabold tabular-nums tracking-tight text-amber-300 2xl:text-xl" title={String(results.framesWithSkipCount)}>
                              {formatNumber(results.framesWithSkipCount)}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 border-t border-white/[0.07] pt-4">
                          <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary">Box ID Range</div>
                          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                            <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-4 py-3">
                              <div className="text-[11px] font-medium text-secondary">First Box ID</div>
                              <div className="mt-1 font-mono text-lg font-bold text-white">{formatBoxId(results.firstBoxId)}</div>
                            </div>
                            <ArrowRight className="mx-auto hidden h-4 w-4 text-white/20 sm:block" />
                            <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-4 py-3">
                              <div className="text-[11px] font-medium text-secondary">Last Box ID</div>
                              <div className="mt-1 font-mono text-lg font-bold text-white">{formatBoxId(results.lastBoxId)}</div>
                            </div>
                          </div>
                        </div>

                        {results.duplicateCount > 0 && (
                          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-orange-400/20 bg-orange-400/[0.08] p-4 text-orange-100 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-start gap-3">
                              <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-400/10">
                                <AlertCircle className="h-4 w-4 text-orange-300" />
                              </span>
                              <div>
                                <div className="text-sm font-semibold">Duplicate Boxes</div>
                                <div className="mt-0.5 text-xs text-orange-100/55">Review boxes sharing the same coordinates</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={handleOpenDuplicateModal}
                              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-orange-300/20 bg-orange-300/10 px-3 py-2 text-xs font-semibold text-orange-200 transition-colors hover:bg-orange-300/20"
                            >
                              View {formatNumber(results.duplicateCount)} boxes
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="glass-panel rounded-2xl border border-white/10 p-8 text-center sm:p-12">
                      <div className="text-sm text-secondary">Kết quả sẽ hiển thị ở đây khi bạn điều chỉnh cấu hình bên trái.</div>
                    </div>
                  )}
                </section>
              </div>

              {isOpenDuplicateModal && duplicateDetails.length > 0 && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm animate-in fade-in sm:p-5">
                  <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0f0f1f] to-[#1a1a2e] shadow-2xl animate-in fade-in slide-in-from-bottom-4">
                    <div className="flex items-start justify-between gap-4 border-b border-white/10 p-4 sm:items-center sm:p-6">
                      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                        <AlertCircle className="h-5 w-5 shrink-0 text-orange-400" />
                        <h2 className="text-lg font-bold text-white sm:text-xl">Duplicate Boxes</h2>
                        <span className="rounded-full border border-orange-500/30 bg-orange-500/20 px-2.5 py-0.5 text-xs font-semibold text-orange-300 sm:text-sm">
                          {duplicateDetails.length} found
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCloseDuplicateModal}
                        className="shrink-0 rounded-lg p-2 transition-colors hover:bg-white/10"
                        title="Close modal"
                        aria-label="Close duplicate boxes modal"
                      >
                        <X className="h-5 w-5 text-zinc-400" />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                      <div className="space-y-2 p-3 sm:p-6">
                        {duplicateDetails.map((item, idx) => (
                          <div
                            key={`${item.frameId}-${item.boxIdA}-${item.boxIdB}-${idx}`}
                            className="rounded-xl border border-white/10 bg-white/5 p-4 transition-all hover:border-white/20 hover:bg-white/10"
                          >
                            <div className="mb-2 flex flex-wrap items-center gap-2 sm:gap-3">
                              <span className="text-sm font-medium text-secondary">Frame</span>
                              <span className="rounded border border-blue-500/30 bg-blue-500/20 px-2.5 py-1 font-mono text-sm font-semibold text-blue-300">{item.frameId}</span>
                              <span className="text-secondary">•</span>
                              <span className="text-sm font-medium text-secondary">Box</span>
                              <span className="rounded border border-purple-500/30 bg-purple-500/20 px-2.5 py-1 font-mono text-sm font-semibold text-purple-300">{item.boxIdA}</span>
                              <span className="font-semibold text-secondary">vs</span>
                              <span className="rounded border border-purple-500/30 bg-purple-500/20 px-2.5 py-1 font-mono text-sm font-semibold text-purple-300">{item.boxIdB}</span>
                            </div>

                            <div className="space-y-2 text-sm text-white/80">
                              {item.labelA === item.labelB ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-white">Label:</span>
                                  <span className="rounded border border-orange-500/30 bg-orange-500/20 px-2.5 py-1 font-medium text-orange-300">{item.labelA || "unknown"}</span>
                                </div>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-white">Label A:</span>
                                  <span className="rounded border border-orange-500/30 bg-orange-500/20 px-2.5 py-1 font-medium text-orange-300">{item.labelA || "unknown"}</span>
                                  <span className="text-secondary">•</span>
                                  <span className="font-semibold text-white">Label B:</span>
                                  <span className="rounded border border-orange-500/30 bg-orange-500/20 px-2.5 py-1 font-medium text-orange-300">{item.labelB || "unknown"}</span>
                                </div>
                              )}

                              {item.coords && (
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                  <span className="text-xs font-semibold text-white">Vị trí:</span>
                                  <span className="rounded border border-green-500/30 bg-green-500/20 px-2.5 py-1 text-xs font-medium text-green-300">
                                    {getBoxPosition(item.coords, item.width, item.height)}
                                  </span>
                                  <span className="text-xs text-secondary">•</span>
                                  <span className="break-all font-mono text-xs text-zinc-400">
                                    ({Math.round(item.coords.xtl)}, {Math.round(item.coords.ytl)}) - ({Math.round(item.coords.xbr)}, {Math.round(item.coords.ybr)})
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 border-t border-white/10 bg-black/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                      <p className="text-xs text-secondary">Showing {duplicateDetails.length} duplicate pair(s)</p>
                      <button
                        type="button"
                        onClick={handleCloseDuplicateModal}
                        className="min-h-10 rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-colors hover:bg-blue-500"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
