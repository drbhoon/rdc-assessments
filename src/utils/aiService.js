export const evaluateReport = async (reportText, type = 'ops') => {
    try {
        const response = await fetch('/api/evaluate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ reportText, type }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        return data.result;
    } catch (error) {
        console.error('Error in evaluateReport client proxy fetch:', error);
        throw new Error(error.message || 'Failed to evaluate report. Please try again.');
    }
};
