// Worker bookkeeping kept by the host's injected script: blob workers (fflate) created / alive / peak alive / terminated, injected faults.
return { phase: window.__phase || null, stats: window.__workerStats || null, blobWorkersListed: (window.__workers || []).filter((w) => w.url.startsWith('blob:')).length, fault: window.__workerFault || null };
