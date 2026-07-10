"use client";

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import { ZipReader, BlobReader, TextWriter } from "@zip.js/zip.js";
import { UploadCloud, File, Trash2, Settings, ChevronDown, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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

interface XmlData {
  minFrame: number;
  maxFrame: number;
  labelHasAttributes: Record<string, boolean>;
  images: ImageInfo[];
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
    firstBoxId: number | string;
    lastBoxId: number | string;
    totalFrames: number;
    duplicateCount: number;
  } | null>(null);

  const [labelDetails, setLabelDetails] = useState<{ label: string; total: number }[]>([]);
  const [noBoxFramesCount, setNoBoxFramesCount] = useState(0);
  const [duplicateDetails, setDuplicateDetails] = useState<DuplicatePairDetail[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [showDuplicateDetails, setShowDuplicateDetails] = useState(false);
  const [isOpenDuplicateModal, setIsOpenDuplicateModal] = useState(false);

  const preserveScrollAfterToggle = () => {
    const currentScrollY = window.scrollY;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: currentScrollY, behavior: "auto" });
      });
    });
  };

  const handleToggleDuplicateDetails = () => {
    setShowDuplicateDetails((prev: boolean) => !prev);
    preserveScrollAfterToggle();
  };

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

  const handleToggleBreakdown = () => {
    setShowDetails((prev: boolean) => !prev);
    preserveScrollAfterToggle();
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

  const isSameCoordinates = (
    a: { xtl: number; ytl: number; xbr: number; ybr: number },
    b: { xtl: number; ytl: number; xbr: number; ybr: number },
    epsilon = 1e-6
  ) => {
    return (
      Math.abs(a.xtl - b.xtl) <= epsilon &&
      Math.abs(a.ytl - b.ytl) <= epsilon &&
      Math.abs(a.xbr - b.xbr) <= epsilon &&
      Math.abs(a.ybr - b.ybr) <= epsilon
    );
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
    };
  };

  const mergeXmlData = (dataList: XmlData[]): XmlData => {
    const labelHasAttributes: Record<string, boolean> = {};
    const imageMap = new Map<string, ImageInfo>();

    dataList.forEach((data) => {
      Object.entries(data.labelHasAttributes).forEach(([label, hasAttr]) => {
        labelHasAttributes[label] = labelHasAttributes[label] || hasAttr;
      });

      data.images.forEach((img) => {
        const key = `${img.id}|${img.name}`;
        if (!imageMap.has(key)) {
          imageMap.set(key, img);
        }
      });
    });

    const mergedImages = Array.from(imageMap.values()).sort((a, b) => a.id - b.id);
    const ids = mergedImages.map((img) => img.id).filter((x) => !isNaN(x));
    const minFrame = ids.length ? Math.min(...ids) : 0;
    const maxFrame = ids.length ? Math.max(...ids) : 0;

    return {
      labelHasAttributes,
      images: mergedImages,
      minFrame,
      maxFrame,
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

  const parseXMLFiles = (xmlContents: string[]) => {
    const validContents = xmlContents.filter((content) => /<image[\s>]/i.test(content));
    if (validContents.length === 0) {
      throw new Error("No valid annotation XML files found in the ZIP archive.");
    }

    const dataList = validContents.map(parseXmlContentToData);
    const mergedData = dataList.length === 1 ? dataList[0] : mergeXmlData(dataList);
    setCurrentXmlData(mergedData);
    setStartFrame(mergedData.minFrame);
    setEndFrame(mergedData.maxFrame);
    setResults(null);
    setError(null);
  };

  const handleFileProcess = (file: File) => {
    setFileName(file.name);
    setLoading(true);
    setError(null);
    setResults(null);
    setCurrentXmlData(null);

    const name = file.name.toLowerCase();

    if (name.endsWith(".xml")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          parseXML(e.target?.result as string);
        } catch (err: any) {
          setError(err.message || "Failed to process XML file.");
        } finally {
          setLoading(false);
        }
      };
      reader.readAsText(file);
    } else if (name.endsWith(".zip")) {
      (async () => {
        try {
          const zipFileReader = new BlobReader(file);
          const zipReader = new ZipReader(zipFileReader);
          const entries = await zipReader.getEntries();
          const xmlFiles = entries.filter((e) => e.filename.match(/\.xml$/i) && !e.directory);
          
          if (xmlFiles.length === 0) {
            setError("No XML file found in the ZIP archive.");
            setLoading(false);
            await zipReader.close();
            return;
          }

          const preferredFile = xmlFiles.find((e) => /annotations\.xml$/i.test(e.filename)) || xmlFiles[0];
          const content = await (preferredFile as any).getData!(new TextWriter());
          await zipReader.close();
          
          parseXML(content);
        } catch (err: any) {
          setError("Error extracting ZIP: " + err.message);
        } finally {
          setLoading(false);
        }
      })();
    } else {
      setError("Please select an .xml or .zip file.");
      setLoading(false);
    }
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileProcess(e.target.files[0]);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragover(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const calculateRange = () => {
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
      firstBoxId,
      lastBoxId,
      totalFrames: filteredImages.length, // Only frames in range
      duplicateCount,
    });
    setDuplicateDetails(duplicatePairs);

    const labelTotals: Record<string, number> = {};
    const labelMissing: Record<string, number> = {};
    const labelOver: Record<string, number> = {};

    filteredImages.forEach((img) => {
      Object.keys(img.labelCounts).forEach((lbl) => {
        labelTotals[lbl] = (labelTotals[lbl] || 0) + img.labelCounts[lbl];
      });
    });

    const detailsArr: { label: string; total: number }[] = [];
    Object.keys(labelTotals)
      .sort()
      .forEach((label) => {
        const total = labelTotals[label];
        if (total === 0) return;
        detailsArr.push({ label, total });
      });

    setLabelDetails(detailsArr);
    setNoBoxFramesCount(filteredImages.filter((img) => img.totalBoxes === 0).length);
  };

  useEffect(() => {
    if (currentXmlData) {
      calculateRange();
    }
  }, [currentXmlData, startFrame, endFrame, excludeLabels]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-16 px-4 transition-colors duration-500 relative">
      <div className="w-full max-w-2xl relative z-10">
        <>
          <div className="absolute -top-32 -left-32 w-64 h-64 bg-blue-600 rounded-full mix-blend-screen filter blur-[128px] opacity-40 pointer-events-none animate-pulse" />
          <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-purple-600 rounded-full mix-blend-screen filter blur-[128px] opacity-40 pointer-events-none animate-pulse" style={{ animationDelay: '1s' }} />
        </>

        <div className={cn(
          "p-8 sm:p-10 rounded-2xl relative z-10 transition-all duration-300 shadow-2xl glass-panel"
        )}>
          <div className="text-center mb-8 mt-2">
            <h1 className="text-4xl font-extrabold tracking-tight mb-3">
              <span className="text-gradient">Annotations</span><span className="text-gradient-accent ml-2">Counter</span>
            </h1>
            <p className="text-sm text-secondary font-medium tracking-wide mb-4">
              Advanced tool to count items and filtered statistics from CVAT labels.
            </p>

          </div>

          {!fileName ? (
            <div
              className={cn(
                "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-300 group",
                dragover ? "border-blue-400 bg-blue-500/5 shadow-[0_0_30px_rgba(59,130,246,0.15)]" : "border-white/10 hover:border-white/20 hover:bg-white/5"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragover(true);
              }}
              onDragLeave={() => setDragover(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4 group-hover:scale-110 group-hover:bg-blue-500/10 transition-transform">
                <UploadCloud className={cn("w-8 h-8", dragover ? "text-blue-400" : "text-zinc-400")} />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Upload file</h3>
              <p className="text-secondary text-sm">kéo thả file <code className="text-white">.xml</code> hoặc <code className="text-white">.zip</code> chứa annotations</p>
              <input type="file" ref={fileInputRef} accept=".xml,.zip" className="hidden" onChange={onFileChange} />
            </div>
          ) : (
            <div className="glass-panel p-4 rounded-xl flex items-center justify-between mb-8 group overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex items-center gap-4 relative z-10">
                <div className="p-3 bg-white/5 rounded-lg">
                  <File className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <div className="text-sm font-medium text-white line-clamp-1">{fileName}</div>
                  <div className="text-xs text-secondary mt-0.5 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-green-400" /> Processed successfully
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setFileName("");
                  setCurrentXmlData(null);
                  setResults(null);
                  setError(null);
                }}
                className="flex items-center gap-2 p-2 px-3 text-red-300 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors relative z-10 text-sm font-semibold"
              >
                <Trash2 className="w-4 h-4" />
                Xóa file
              </button>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-red-300 mb-1">Error Parsing Data</div>
                {error}
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12 text-zinc-400 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
              <span className="font-medium tracking-wide">Processing your file...</span>
            </div>
          )}

          {currentXmlData && (
            <div className="space-y-6 animate-in slide-in-from-bottom-4 fade-in duration-500 mt-8">
              <div className="grid grid-cols-2 gap-4">
                <div className="glass-panel p-4 rounded-xl border border-white/5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-secondary mb-2 block">Start Frame</label>
                  <input
                    type="number"
                    autoComplete="off"
                    value={startFrame}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setStartFrame(isNaN(val) ? "" : val);
                    }}
                    onBlur={() => {
                      if (!currentXmlData) return;
                      if (startFrame === "" || (typeof startFrame === "number" && (startFrame < currentXmlData.minFrame || startFrame > currentXmlData.maxFrame))) {
                        setStartFrame(currentXmlData.minFrame);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="w-full bg-transparent text-xl font-semibold text-white outline-none border-b border-white/10 focus:border-blue-500 transition-colors pb-2"
                  />
                </div>
                <div className="glass-panel p-4 rounded-xl border border-white/5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-secondary mb-2 block">End Frame</label>
                  <input
                    type="number"
                    autoComplete="off"
                    value={endFrame}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setEndFrame(isNaN(val) ? "" : val);
                    }}
                    onBlur={() => {
                      if (!currentXmlData) return;
                      if (endFrame === "" || (typeof endFrame === "number" && (endFrame < currentXmlData.minFrame || endFrame > currentXmlData.maxFrame))) {
                        setEndFrame(currentXmlData.maxFrame);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="w-full bg-transparent text-xl font-semibold text-white outline-none border-b border-white/10 focus:border-blue-500 transition-colors pb-2"
                  />
                </div>
              </div>

              <div>
                <button
                  onClick={() => setShowExcludePanel(!showExcludePanel)}
                  className="w-full flex items-center justify-between p-4 glass-panel rounded-xl hover:bg-white/5 transition-colors border border-white/5"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Settings className="w-4 h-4 text-zinc-400" />
                    Exclude Configuration
                  </div>
                  <ChevronDown className={cn("w-4 h-4 text-zinc-400 transition-transform", showExcludePanel && "rotate-180")} />
                </button>

                {showExcludePanel && (
                  <div className="mt-2 glass-panel p-5 rounded-xl border border-white/5 animate-in slide-in-from-top-2 fade-in">
                    <p className="text-xs text-secondary mb-3">Labels added here will be excluded from the final target count.</p>
                    <div className="flex gap-2 mb-4">
                      <input
                        className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                        type="text"
                        placeholder="e.g. _corrupt"
                        value={newExcludeLabel}
                        onChange={(e) => setNewExcludeLabel(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddExclude()}
                      />
                      <button
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors shadow-lg shadow-blue-500/20"
                        onClick={handleAddExclude}
                      >
                        Add
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {excludeLabels.map((lbl) => (
                        <div key={lbl} className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-md text-xs font-medium text-white flex items-center gap-2 group hover:bg-white/10 transition-colors">
                          <span>{lbl}</span>
                          <button onClick={() => handleRemoveExclude(lbl)} className="text-zinc-500 hover:text-white transition-colors">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {results && (
                <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden relative">
                  <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 to-purple-500" />

                  <div className="p-6 sm:p-8">
                    <h3 className="text-lg font-bold text-white mb-6">Statistic Overview</h3>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-8">
                      <div>
                        <div className="text-xs text-secondary font-medium uppercase tracking-wider mb-1">Included Frames</div>
                        <div className="text-3xl font-extrabold text-white">{results.totalFrames}</div>
                      </div>
                      <div>
                        <div className="text-xs text-secondary font-medium uppercase tracking-wider mb-1">Total Boxes</div>
                        <div className="text-3xl font-extrabold text-blue-400">{results.totalBoxesCount}</div>
                      </div>
                      <div>
                        <div className="text-xs text-secondary font-medium uppercase tracking-wider mb-1">Excluded</div>
                        <div className="text-3xl font-extrabold text-purple-400">{results.excludeCount}</div>
                      </div>
                      <div>
                        <div className="text-xs text-secondary font-medium uppercase tracking-wider mb-1">Final Count</div>
                        <div className="text-3xl font-extrabold text-green-400">{results.totalAfterExclude}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm mb-6 pb-6 border-b border-white/5">
                      {results.framesWithSkipCount > 0 && (
                        <div className="col-span-2 flex items-center justify-between p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-200 mb-2 shadow-inner">
                          <span className="font-medium flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            Frames Skipped/Passed
                          </span>
                          <span className="font-bold text-lg">{results.framesWithSkipCount}</span>
                        </div>
                      )}

                      {results.duplicateCount > 0 && (
                        <div className="col-span-2 flex items-center justify-between p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-200 mb-2 shadow-inner">
                          <span className="font-medium flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            Duplicate Boxes
                          </span>
                          <span className="font-bold text-lg">{results.duplicateCount}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                        <span className="text-secondary">First Box ID</span>
                        <span className="font-mono font-medium text-white">{results.firstBoxId}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                        <span className="text-secondary">Last Box ID</span>
                        <span className="font-mono font-medium text-white">{results.lastBoxId}</span>
                      </div>
                    </div>

                    {duplicateDetails.length > 0 && (
                      <button
                        onClick={handleOpenDuplicateModal}
                        className="w-full mb-4 px-4 py-3 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-xl text-orange-300 font-semibold transition-colors text-sm uppercase tracking-widest"
                      >
                        View Duplicate Boxes ({duplicateDetails.length})
                      </button>
                    )}

                    {isOpenDuplicateModal && duplicateDetails.length > 0 && (
                      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                        <div className="bg-gradient-to-br from-[#0f0f1f] to-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col animate-in slide-in-from-bottom-4 fade-in">
                          {/* Header */}
                          <div className="flex items-center justify-between p-6 border-b border-white/10">
                            <div className="flex items-center gap-3">
                              <AlertCircle className="w-5 h-5 text-orange-400" />
                              <h2 className="text-xl font-bold text-white">Duplicate Boxes</h2>
                              <span className="ml-2 px-2.5 py-0.5 bg-orange-500/20 border border-orange-500/30 rounded-full text-sm font-semibold text-orange-300">
                                {duplicateDetails.length} found
                              </span>
                            </div>
                            <button
                              onClick={handleCloseDuplicateModal}
                              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                              title="Close modal"
                            >
                              <svg className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>

                          {/* Content */}
                          <div className="overflow-y-auto flex-1">
                            <div className="space-y-2 p-6">
                              {duplicateDetails.map((item, idx) => (
                                <div key={`${item.frameId}-${item.boxIdA}-${item.boxIdB}-${idx}`} className="p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all">
                                  <div className="flex flex-wrap items-center gap-3 mb-2">
                                    <span className="text-sm text-secondary font-medium">Frame</span>
                                    <span className="px-2.5 py-1 rounded bg-blue-500/20 border border-blue-500/30 font-mono text-sm font-semibold text-blue-300">{item.frameId}</span>
                                    <span className="text-secondary">•</span>
                                    <span className="text-sm text-secondary font-medium">Box</span>
                                    <span className="px-2.5 py-1 rounded bg-purple-500/20 border border-purple-500/30 font-mono text-sm font-semibold text-purple-300">{item.boxIdA}</span>
                                    <span className="text-secondary font-semibold">vs</span>
                                    <span className="px-2.5 py-1 rounded bg-purple-500/20 border border-purple-500/30 font-mono text-sm font-semibold text-purple-300">{item.boxIdB}</span>
                                  </div>
                                  <div className="text-sm text-white/80 space-y-2">
                                    {item.labelA === item.labelB ? (
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-white">Label:</span>
                                        <span className="px-2.5 py-1 rounded bg-orange-500/20 border border-orange-500/30 text-orange-300 font-medium">
                                          {item.labelA || "unknown"}
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold text-white">Label A:</span>
                                        <span className="px-2.5 py-1 rounded bg-orange-500/20 border border-orange-500/30 text-orange-300 font-medium">
                                          {item.labelA || "unknown"}
                                        </span>
                                        <span className="text-secondary">•</span>
                                        <span className="font-semibold text-white">Label B:</span>
                                        <span className="px-2.5 py-1 rounded bg-orange-500/20 border border-orange-500/30 text-orange-300 font-medium">
                                          {item.labelB || "unknown"}
                                        </span>
                                      </div>
                                    )}
                                    {item.coords && (
                                      <div className="flex flex-wrap items-center gap-2 pt-1">
                                        <span className="font-semibold text-white text-xs">Vị trí:</span>
                                        <span className="px-2.5 py-1 rounded bg-green-500/20 border border-green-500/30 text-green-300 font-medium text-xs">
                                          {getBoxPosition(item.coords, item.width, item.height)}
                                        </span>
                                        <span className="text-secondary text-xs">•</span>
                                        <span className="text-xs text-zinc-400 font-mono">
                                          ({Math.round(item.coords.xtl)}, {Math.round(item.coords.ytl)}) - ({Math.round(item.coords.xbr)}, {Math.round(item.coords.ybr)})
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Footer */}
                          <div className="flex items-center justify-between p-6 border-t border-white/10 bg-black/40">
                            <p className="text-xs text-secondary">Showing {duplicateDetails.length} duplicate pair(s)</p>
                            <button
                              onClick={handleCloseDuplicateModal}
                              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors shadow-lg shadow-blue-500/20"
                            >
                              Close
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <button
                      onClick={handleToggleBreakdown}
                      className="group flex flex-col items-center justify-center w-full"
                    >
                      <div className="text-xs font-semibold uppercase tracking-widest text-secondary group-hover:text-white transition-colors flex items-center gap-2">
                        {showDetails ? "Hide Breakdown" : "View Label Breakdown"}
                        <ChevronDown className={cn("w-4 h-4 transition-transform", showDetails && "rotate-180")} />
                      </div>
                    </button>

                    {showDetails && (
                      <div className="mt-6 space-y-2 animate-in slide-in-from-top-4 fade-in">
                        {labelDetails.map((item) => (
                          <div key={item.label} className="flex justify-between items-center p-3 sm:p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-transparent hover:border-white/5 group">
                            <span className="font-medium text-white flex items-center flex-wrap gap-2">
                              {item.label}
                            </span>
                            <span className="text-xl font-bold font-mono text-zinc-300">{item.total}</span>
                          </div>
                        ))}
                        {noBoxFramesCount > 0 && (
                          <div className="flex justify-between items-center p-4 rounded-xl bg-red-500/5 border border-red-500/10 mt-4">
                            <span className="font-medium text-red-300 flex items-center gap-2">
                              <AlertCircle className="w-4 h-4" />
                              Empty Frames
                            </span>
                            <span className="text-xl font-bold font-mono text-red-400">{noBoxFramesCount}</span>
                          </div>
                        )}
                        {labelDetails.length === 0 && noBoxFramesCount === 0 && (
                          <div className="text-center py-4 text-sm text-secondary">
                            No label details found in the selected range.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
